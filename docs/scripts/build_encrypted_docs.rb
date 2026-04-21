#!/usr/bin/env ruby
# frozen_string_literal: true

require "base64"
require "cgi"
require "fileutils"
require "json"
require "openssl"
require "pathname"
require "yaml"

require "kramdown"
require "kramdown-parser-gfm"

SITE_ROOT = Pathname(__dir__).join("..").realpath
CONFIG = YAML.safe_load_file(SITE_ROOT.join("_config.yml"), aliases: true)
MANIFEST = YAML.safe_load_file(SITE_ROOT.join("_data/published_docs.yml"), aliases: true)
PASSWORD = ENV.fetch("DOCS_PASSWORD") do
  abort("Missing DOCS_PASSWORD. Export the password before building encrypted docs.")
end

ENCRYPTED_DIR = SITE_ROOT.join("assets/encrypted")
PAGES_DIR = SITE_ROOT.join("_published_docs")

def strip_front_matter(markdown)
  markdown.sub(/\A---\s*\n.*?\n---\s*\n/m, "")
end

def encoded_path(path)
  path.split("/").map { |segment| CGI.escape(segment).tr("+", "%20") }.join("/")
end

def repo_relative_path(path)
  clean_path = Pathname(path).cleanpath.to_s
  clean_path.start_with?("docs/") ? clean_path : "docs/#{clean_path}"
end

def repo_blob_url(path)
  ref = ENV.fetch("DOCS_SOURCE_REF", CONFIG.fetch("source_ref", "main"))
  "#{CONFIG.fetch('repository_url')}/blob/#{ref}/#{encoded_path(repo_relative_path(path))}"
end

def repo_raw_url(path)
  ref = ENV.fetch("DOCS_SOURCE_REF", CONFIG.fetch("source_ref", "main"))
  repo = CONFIG.fetch("repository_url").sub("https://github.com/", "")
  "https://raw.githubusercontent.com/#{repo}/#{ref}/#{encoded_path(repo_relative_path(path))}"
end

def published_lookup
  @published_lookup ||= MANIFEST.each_with_object({}) do |doc, map|
    relative = Pathname(doc.fetch("source")).cleanpath.to_s
    map[relative] = doc
  end
end

def basename_lookup
  @basename_lookup ||= Dir.glob(SITE_ROOT.join("**/*").to_s).each_with_object(Hash.new { |hash, key| hash[key] = [] }) do |path, map|
    next unless File.file?(path)

    relative = Pathname(path).relative_path_from(SITE_ROOT).to_s
    map[File.basename(relative)] << relative
  end
end

def absolute_source(path)
  SITE_ROOT.join(path).cleanpath
end

def resolve_relative_site_path(current_source, target)
  source_dir = Pathname(current_source).dirname
  source_dir.join(target).cleanpath.to_s
end

def rewrite_href(current_doc, href)
  return href if href.nil? || href.empty?
  return href if href.start_with?("http://", "https://", "mailto:", "tel:", "#", "data:")

  path, fragment = href.split("#", 2)
  return href if path.nil? || path.empty?

  site_path =
    if path.start_with?("/")
      path.sub(%r{\A/}, "")
    else
      resolve_relative_site_path(current_doc.fetch("source"), path)
    end

  unless absolute_source(site_path).exist?
    basename_matches = basename_lookup[File.basename(path)]
    site_path = basename_matches.first if basename_matches.size == 1
  end

  if path.downcase.end_with?(".md") && published_lookup[site_path]
    target_slug = published_lookup.fetch(site_path).fetch("slug")
    rewritten = "../#{target_slug}/"
    return fragment ? "#{rewritten}##{fragment}" : rewritten
  end

  absolute = absolute_source(site_path)
  return href unless absolute.exist?

  base =
    if File.extname(site_path).downcase.match?(/\A\.(png|jpe?g|gif|svg|webp)\z/)
      repo_raw_url(site_path)
    else
      repo_blob_url(site_path)
    end

  fragment ? "#{base}##{fragment}" : base
end

def rewrite_html_links(html, current_doc)
  html.gsub(/<(a|img)\b([^>]*?)\s(href|src)="([^"]+)"([^>]*)>/i) do
    tag = Regexp.last_match(1)
    before = Regexp.last_match(2)
    attribute = Regexp.last_match(3)
    value = Regexp.last_match(4)
    after = Regexp.last_match(5)
    rewritten = rewrite_href(current_doc, value)
    "<#{tag}#{before} #{attribute}=\"#{rewritten}\"#{after}>"
  end
end

def render_html(markdown, current_doc)
  document = Kramdown::Document.new(
    strip_front_matter(markdown),
    input: "GFM",
    auto_ids: true,
    syntax_highlighter: "rouge"
  )

  rewrite_html_links(document.to_html, current_doc)
end

def encrypt_html(html)
  salt = OpenSSL::Random.random_bytes(16)
  iv = OpenSSL::Random.random_bytes(12)
  iterations = 210_000
  key = OpenSSL::PKCS5.pbkdf2_hmac(PASSWORD, salt, iterations, 32, "sha256")

  cipher = OpenSSL::Cipher.new("aes-256-gcm")
  cipher.encrypt
  cipher.key = key
  cipher.iv = iv

  ciphertext = cipher.update(html) + cipher.final
  tag = cipher.auth_tag

  {
    version: 1,
    alg: "AES-GCM",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: iterations,
      salt: Base64.strict_encode64(salt)
    },
    iv: Base64.strict_encode64(iv),
    ciphertext: Base64.strict_encode64(ciphertext),
    tag: Base64.strict_encode64(tag)
  }
end

def build_page_front_matter(doc)
  <<~YAML
    ---
    layout: gated_doc
    title: #{doc.fetch("title").to_json}
    description: #{doc.fetch("summary").to_json}
    summary: #{doc.fetch("summary").to_json}
    section: #{doc.fetch("section").to_json}
    audience: #{doc.fetch("audience", "").to_json}
    source_path: #{doc.fetch("source").to_json}
    doc_slug: #{doc.fetch("slug").to_json}
    payload: #{"/assets/encrypted/#{doc.fetch('slug')}.json".to_json}
    ---
  YAML
end

FileUtils.mkdir_p(ENCRYPTED_DIR)
FileUtils.mkdir_p(PAGES_DIR)
Dir.glob(ENCRYPTED_DIR.join("*.json").to_s).each { |file| FileUtils.rm_f(file) }
Dir.glob(PAGES_DIR.join("*.md").to_s).each { |file| FileUtils.rm_f(file) }

MANIFEST.each do |doc|
  source_path = Pathname(doc.fetch("source")).cleanpath.to_s
  source_file = absolute_source(source_path)
  abort("Missing source markdown: #{source_path}") unless source_file.exist?

  markdown = source_file.read
  html = render_html(markdown, doc)
  payload = encrypt_html(html)

  ENCRYPTED_DIR.join("#{doc.fetch('slug')}.json").write(JSON.pretty_generate(payload) + "\n")
  PAGES_DIR.join("#{doc.fetch('slug')}.md").write(build_page_front_matter(doc))
end

puts "Generated #{MANIFEST.size} encrypted payloads in #{ENCRYPTED_DIR.relative_path_from(SITE_ROOT)}."
