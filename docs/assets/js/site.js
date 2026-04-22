(function () {
  const themeStorageKey = "futurekey-docs-theme";
  const gateStorageKey = "futurekey-docs-session-password";
  let mermaidRenderCount = 0;

  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function getPreferredTheme() {
    const storedTheme = localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const toggle = document.querySelector("[data-theme-toggle]");
    const label = document.querySelector("[data-theme-label]");

    if (toggle) {
      toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }

    if (label) {
      label.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    }
  }

  function getMermaidTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
  }

  function normalizeMermaidBlocks(root) {
    root.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
      const pre = code.parentElement;
      if (!pre || pre.parentElement?.matches("[data-mermaid-wrapper]")) {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram";
      wrapper.setAttribute("data-mermaid-wrapper", "");
      wrapper.dataset.mermaidSource = code.textContent || "";

      const graph = document.createElement("div");
      graph.className = "mermaid-diagram__graph";
      graph.setAttribute("data-mermaid-graph", "");
      wrapper.appendChild(graph);

      pre.replaceWith(wrapper);
    });
  }

  async function renderMermaidDiagrams(root) {
    if (!root || !window.mermaid) {
      return;
    }

    normalizeMermaidBlocks(root);
    window.mermaid.initialize({
      startOnLoad: false,
      theme: getMermaidTheme(),
    });

    const wrappers = Array.from(root.querySelectorAll("[data-mermaid-wrapper]"));

    await Promise.all(wrappers.map(async (wrapper) => {
      const target = wrapper.querySelector("[data-mermaid-graph]");
      const source = wrapper.dataset.mermaidSource;

      if (!target || !source) {
        return;
      }

      try {
        const { svg, bindFunctions } = await window.mermaid.render(`futurekey-docs-mermaid-${++mermaidRenderCount}`, source);
        target.innerHTML = svg;
        bindFunctions?.(target);
        wrapper.classList.remove("mermaid-diagram--error");
      } catch (error) {
        wrapper.classList.add("mermaid-diagram--error");
        target.replaceChildren();

        const fallback = document.createElement("pre");
        fallback.className = "mermaid-diagram__fallback";
        fallback.textContent = source;
        target.appendChild(fallback);
      }
    }));
  }

  async function decryptPayload(password, payload) {
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: fromBase64(payload.kdf.salt),
        iterations: payload.kdf.iterations,
        hash: payload.kdf.hash,
      },
      passwordKey,
      { name: payload.alg, length: 256 },
      false,
      ["decrypt"]
    );

    const cipherBytes = fromBase64(payload.ciphertext);
    const tagBytes = fromBase64(payload.tag);
    const encryptedBytes = new Uint8Array(cipherBytes.length + tagBytes.length);
    encryptedBytes.set(cipherBytes);
    encryptedBytes.set(tagBytes, cipherBytes.length);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: payload.alg,
        iv: fromBase64(payload.iv),
        tagLength: 128,
      },
      aesKey,
      encryptedBytes
    );

    return textDecoder.decode(decrypted);
  }

  function buildToc(shell) {
    const toc = shell.querySelector("[data-doc-toc]");
    const nav = toc?.querySelector("nav");
    const content = shell.querySelector("[data-doc-content]");
    const surface = shell.querySelector("[data-doc-surface]");

    if (!toc || !nav || !content) {
      return;
    }

    const headings = Array.from(content.querySelectorAll("h2, h3"));
    nav.innerHTML = "";

    if (!headings.length) {
      toc.hidden = true;
      surface?.classList.remove("has-toc");
      return;
    }

    headings.forEach((heading, index) => {
      if (!heading.id) {
        const slug = heading.textContent
          .trim()
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/(^-|-$)/g, "");
        heading.id = slug || `section-${index + 1}`;
      }

      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;

      if (heading.tagName === "H3") {
        link.classList.add("toc-link--nested");
      }

      nav.appendChild(link);
    });

    toc.hidden = false;
    surface?.classList.add("has-toc");
  }

  function setPanelVisibility(shell, isVisible) {
    const panel = shell.querySelector("[data-gate-panel]");
    const toggle = shell.querySelector("[data-gate-toggle-panel]");

    if (panel) {
      panel.hidden = !isVisible;
    }

    if (toggle) {
      toggle.textContent = isVisible ? "Hide access panel" : "Show access panel";
      toggle.setAttribute("aria-expanded", isVisible ? "true" : "false");
    }
  }

  function setUnlockedState(shell, isUnlocked, message) {
    const toolbar = shell.querySelector("[data-gate-toolbar]");
    const toolbarStatus = shell.querySelector("[data-gate-toolbar-status]");
    const clearButtons = shell.querySelectorAll("[data-gate-clear]");

    if (toolbar) {
      toolbar.hidden = !isUnlocked;
    }

    clearButtons.forEach((button) => {
      if (isUnlocked) {
        button.removeAttribute("hidden");
      } else {
        button.setAttribute("hidden", "hidden");
      }
    });

    if (toolbarStatus && message) {
      toolbarStatus.textContent = message;
    }
  }

  function resetUnlockedDocument(shell) {
    const surface = shell.querySelector("[data-doc-surface]");
    const content = shell.querySelector("[data-doc-content]");
    const toc = shell.querySelector("[data-doc-toc]");
    const tocNav = toc?.querySelector("nav");

    if (content) {
      content.innerHTML = "";
    }

    if (tocNav) {
      tocNav.innerHTML = "";
    }

    if (toc) {
      toc.hidden = true;
    }

    if (surface) {
      surface.hidden = true;
      surface.classList.remove("has-toc");
    }
  }

  async function unlockDocument(shell, password) {
    const status = shell.querySelector("[data-gate-status]");
    const submit = shell.querySelector("[data-gate-submit]");
    const surface = shell.querySelector("[data-doc-surface]");
    const content = shell.querySelector("[data-doc-content]");
    const payloadUrl = shell.dataset.payloadUrl;
    const alreadyUnlocked = surface ? !surface.hidden : false;

    if (!payloadUrl || !surface || !content) {
      return false;
    }

    submit?.setAttribute("disabled", "disabled");
    if (status) {
      status.textContent = "Decrypting document...";
      status.classList.remove("status-message--error", "status-message--success");
    }

    try {
      const response = await fetch(payloadUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("The encrypted payload could not be loaded.");
      }

      const payload = await response.json();
      const html = await decryptPayload(password, payload);
      content.innerHTML = html;
      await renderMermaidDiagrams(content);
      surface.hidden = false;
      sessionStorage.setItem(gateStorageKey, password);
      buildToc(shell);
      setUnlockedState(shell, true, "Document decrypted for this browser session.");
      setPanelVisibility(shell, false);

      if (status) {
        status.textContent = "Document decrypted for this browser session.";
        status.classList.remove("status-message--error");
        status.classList.add("status-message--success");
      }

      return true;
    } catch (error) {
      if (!alreadyUnlocked) {
        sessionStorage.removeItem(gateStorageKey);
        resetUnlockedDocument(shell);
        setUnlockedState(shell, false);
        setPanelVisibility(shell, true);
      }

      if (status) {
        status.textContent = "Password incorrect, or the payload could not be decrypted.";
        status.classList.remove("status-message--success");
        status.classList.add("status-message--error");
      }

      return false;
    } finally {
      submit?.removeAttribute("disabled");
    }
  }

  function initTheme() {
    applyTheme(getPreferredTheme());
    document.querySelector("[data-theme-toggle]")?.addEventListener("click", function () {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(themeStorageKey, nextTheme);
      applyTheme(nextTheme);
      renderMermaidDiagrams(document);
    });
  }

  function initGatedDocs() {
    document.querySelectorAll("[data-gated-doc]").forEach((shell) => {
      const form = shell.querySelector("[data-gate-form]");
      const input = shell.querySelector("[data-gate-input]");
      const clearButtons = shell.querySelectorAll("[data-gate-clear]");
      const togglePanelButton = shell.querySelector("[data-gate-toggle-panel]");
      const sessionPassword = sessionStorage.getItem(gateStorageKey);

      if (sessionPassword) {
        unlockDocument(shell, sessionPassword);
      }

      form?.addEventListener("submit", async function (event) {
        event.preventDefault();
        const password = input?.value || "";
        if (!password) {
          return;
        }

        const success = await unlockDocument(shell, password);
        if (success && input) {
          input.value = "";
        }
      });

      togglePanelButton?.addEventListener("click", function () {
        const panel = shell.querySelector("[data-gate-panel]");
        const shouldShow = panel?.hidden ?? true;
        setPanelVisibility(shell, shouldShow);
        if (shouldShow) {
          input?.focus();
        }
      });

      clearButtons.forEach((button) => {
        button.addEventListener("click", function () {
          sessionStorage.removeItem(gateStorageKey);
          const status = shell.querySelector("[data-gate-status]");
          resetUnlockedDocument(shell);
          setUnlockedState(shell, false);
          setPanelVisibility(shell, true);

          if (status) {
            status.textContent = "Session password cleared. Enter the password again to decrypt this page.";
            status.classList.remove("status-message--success", "status-message--error");
          }

          input?.focus();
        });
      });
    });
  }

  initTheme();
  initGatedDocs();
})();
