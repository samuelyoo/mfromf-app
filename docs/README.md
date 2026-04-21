# FutureKey Team Docs

This folder contains the GitHub Pages site for sharing selected FutureKey / mfromf planning documents with the team.

## Local Preview

```bash
cd docs
bundle install
export DOCS_PASSWORD='replace-me'
bundle exec ruby scripts/build_encrypted_docs.rb
bundle exec jekyll serve
```

## Deployment

The repository-level workflow at `.github/workflows/docs-pages.yml` builds this site, encrypts the published docs, and deploys to GitHub Pages.
