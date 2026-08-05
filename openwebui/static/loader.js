/*
 * NetTAP Engineering Intelligence runtime branding.
 *
 * LICENSE GUARD:
 * KEEP_OPEN_WEBUI_ATTRIBUTION should remain true unless your deployment
 * qualifies for the Open WebUI branding exception or has an Enterprise license.
 */
(() => {
  "use strict";

  const CONFIG = Object.freeze({
    productName: "NetTAP Engineering Intelligence",
    securityNotice:
      "Authorized users only. Verify product specifications, pricing, compatibility, and production designs against approved NetTAP sources.",
    keepOpenWebUIAttribution: true
  });

  const SUGGESTION_PROFILES = Object.freeze([
    {
      key: "packet-expert",
      modelNames: [
        "NetTAP Packet Expert",
        "NetTAP Packet Expert (Clone)",
        "NetTAP PCAP Expert",
        "NetTAP PCAP Expert (Clone)"
      ],
      heading: "Packet Expert Quick Actions",
      description: "Start with packet evidence, performance, or threat behavior.",
      groups: [
        {
          label: "Packet Evidence",
          description: "Validate the capture and explain protocol behavior",
          titles: [
            "Analyze Packet Capture",
            "Diagnose TCP Performance",
            "Validate Capture Quality"
          ]
        },
        {
          label: "Security Investigation",
          description: "Investigate hosts, encrypted traffic, and data movement",
          titles: [
            "Investigate Suspicious Host",
            "Audit DNS and TLS",
            "Hunt C2 and Exfiltration"
          ]
        }
      ]
    },
    {
      key: "network-visibility",
      modelNames: [
        "NetTAP Network & Visibility Architect",
        "NetTAP Network & Visibility Architect (Clone)"
      ],
      heading: "Network Visibility Quick Actions",
      description: "Start with architecture, evidence coverage, or service health.",
      groups: [
        {
          label: "Architecture & Coverage",
          description: "Design resilient visibility paths and expose blind spots",
          titles: [
            "Design Visibility Architecture",
            "Find Security Visibility Gaps",
            "Validate TAP SPAN and NPB Design"
          ]
        },
        {
          label: "Operations & Assurance",
          description: "Troubleshoot service health and validate network paths",
          titles: [
            "Troubleshoot Service Outage",
            "Diagnose Packet Loss and Latency",
            "Validate Routing and Network Path"
          ]
        }
      ]
    }
  ]);

  const qs = (selector, root = document) => root.querySelector(selector);

  function setDocumentBrand() {
    if (document.title !== CONFIG.productName) {
      document.title = CONFIG.productName;
    }

    let meta = qs('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#071a33");
  }

  function createBrandPanel() {
    const panel = document.createElement("div");
    panel.id = "nettap-brand-panel";
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "NetTAP Engineering Intelligence");

    panel.innerHTML = `
      <div>
        <img
          class="nettap-wordmark"
          src="/static/nettap-main-logo.png"
          alt="NetTAP Engineering Intelligence"
        />
        <p class="nettap-kicker">Contained AI</p>
        <h1 class="nettap-hero-title">See every packet &amp; test every signal.</h1>
        <p class="nettap-hero-copy">
          NetTAP Private AI securely assists with network troubleshooting,
          security operations, packet analysis, optical connectivity, and
          L2–L7 testing.
        </p>
        <ul class="nettap-capabilities" aria-label="Capabilities">
          <li>Trace traffic from TAP or SPAN through packet brokers to security tools</li>
          <li>Analyze packet evidence and identify visibility gaps</li>
          <li>Design and validate optics, fiber, cabling, and high-speed links</li>
        </ul>
      </div>
      ${
        CONFIG.keepOpenWebUIAttribution
          ? '<p id="nettap-license-attribution">NetTAP-branded deployment powered by Open WebUI.</p>'
          : ""
      }
    `;

    return panel;
  }

  function addSecurityNotice(authPage) {
    if (qs("#nettap-security-notice", authPage)) return;
    const form = qs("form", authPage);
    if (!form) return;

    const notice = document.createElement("p");
    notice.id = "nettap-security-notice";
    notice.textContent = CONFIG.securityNotice;
    form.insertAdjacentElement("afterend", notice);
  }

  function addPasswordHelp(authPage) {
    if (qs("#nettap-password-help", authPage)) return;
    const form = qs("form", authPage);
    if (!form) return;

    const help = document.createElement("section");
    help.id = "nettap-password-help";
    help.setAttribute("aria-label", "Account access help");
    help.innerHTML = `
      <button
        id="nettap-password-help-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="nettap-password-help-content"
      >
        Forgot your password?
      </button>
      <div id="nettap-password-help-content" hidden>
        <strong>Password reset</strong>
        <p>
          For security, password resets are completed by a NetTAP administrator.
          Ask your administrator to issue a temporary password, then change it
          immediately after signing in.
        </p>
      </div>
      <p class="nettap-registration-help">
        New user? Choose <strong>Sign up</strong>. New accounts remain pending
        until a NetTAP administrator approves access.
      </p>
    `;

    form.insertAdjacentElement("afterend", help);

    const toggle = qs("#nettap-password-help-toggle", help);
    const content = qs("#nettap-password-help-content", help);
    toggle?.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      content.hidden = expanded;
    });
  }

  function cleanVisibleProductName(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const updates = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.nodeValue || "";
      if (value.includes("Open WebUI") && value.includes("NetTAP")) {
        updates.push(node);
      }
    }

    for (const node of updates) {
      node.nodeValue = node.nodeValue
        .replace(/\s*\(Open WebUI\)\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  function applyAuthBranding() {
    const authPage = qs("#auth-page");
    if (!authPage) return;

    authPage.classList.add("nettap-auth-page");
    const container = qs("#auth-container", authPage);
    if (!container) return;

    if (!qs("#nettap-brand-panel", container)) {
      container.prepend(createBrandPanel());
    }

    addPasswordHelp(authPage);
    addSecurityNotice(authPage);
    cleanVisibleProductName(authPage);
  }

  function applyChatBranding() {
    const authPage = qs("#auth-page");
    const existing = qs("#nettap-chat-brand");

    if (authPage) {
      existing?.remove();
      return;
    }

    if (existing) return;

    const brand = document.createElement("div");
    brand.id = "nettap-chat-brand";
    brand.setAttribute("aria-label", "NetTAP Engineering Intelligence");
    brand.innerHTML = `
      <img
        src="/static/nettap-main-logo.png"
        alt="NetTAP"
      />
      <span>Network Observability &amp; Security Intelligence</span>
    `;
    document.body.append(brand);
  }

  function clearChatProfile() {
    delete document.body.dataset.nettapChatProfile;
    document
      .querySelectorAll(
        ".nettap-model-hero, .nettap-model-title-wrap, .nettap-model-title"
      )
      .forEach((element) => {
        element.classList.remove(
          "nettap-model-hero",
          "nettap-model-title-wrap",
          "nettap-model-title"
        );
      });
  }

  function applyChatProfile(profile) {
    if (document.body.dataset.nettapChatProfile !== profile.key) {
      clearChatProfile();
      document.body.dataset.nettapChatProfile = profile.key;
    }

    const modelTitle = Array.from(document.querySelectorAll("span")).find(
      (element) => {
        if (!profile.modelNames.includes(element.textContent?.trim() || "")) {
          return false;
        }

        return Array.from(element.parentElement?.parentElement?.classList || [])
          .includes("text-3xl");
      }
    );

    if (!modelTitle) return;

    const titleWrap = modelTitle.parentElement?.parentElement;
    const hero = titleWrap?.parentElement;
    if (!modelTitle.classList.contains("nettap-model-title")) {
      modelTitle.classList.add("nettap-model-title");
    }
    if (titleWrap && !titleWrap.classList.contains("nettap-model-title-wrap")) {
      titleWrap.classList.add("nettap-model-title-wrap");
    }
    if (hero && !hero.classList.contains("nettap-model-hero")) {
      hero.classList.add("nettap-model-hero");
    }
  }

  function organizeSuggestions() {
    const knownTitles = SUGGESTION_PROFILES.flatMap((profile) =>
      profile.groups.flatMap((group) => group.titles)
    );
    const suggestions = Array.from(
      document.querySelectorAll('button[role="listitem"]')
    ).filter((button) => {
      const text = button.textContent?.trim().toLowerCase() || "";
      return knownTitles.some((title) => text.startsWith(title.toLowerCase()));
    });

    if (!suggestions.length) {
      clearChatProfile();
      return;
    }
    const list = suggestions[0].closest('[role="list"]');
    if (!list) return;
    const byTitle = new Map();
    for (const button of suggestions) {
      const text = button.textContent?.trim().toLowerCase() || "";
      const title = knownTitles.find((candidate) =>
        text.startsWith(candidate.toLowerCase())
      );
      if (title) byTitle.set(title, button);
    }

    const activeProfile = SUGGESTION_PROFILES
      .map((profile) => ({
        profile,
        matches: profile.groups
          .flatMap((group) => group.titles)
          .filter((title) => byTitle.has(title)).length
      }))
      .sort((left, right) => right.matches - left.matches)[0];

    if (!activeProfile || activeProfile.matches === 0) return;

    const { profile } = activeProfile;
    applyChatProfile(profile);
    const expectedOrder = profile.groups.flatMap((group) =>
      group.titles.filter((title) => byTitle.has(title))
    ).slice(0, 6);
    const currentOrder = Array.from(
      list.querySelectorAll('button[role="listitem"]')
    ).map((button) =>
      knownTitles.find((title) =>
        (button.textContent?.trim().toLowerCase() || "").startsWith(
          title.toLowerCase()
        )
      )
    ).filter(Boolean);
    const groups = Array.from(
      list.querySelectorAll(":scope > .nettap-suggestion-group")
    );
    const dashboardHeader = list.querySelector(
      ":scope > .nettap-suggestion-dashboard-intro"
    );
    const orderMatches =
      expectedOrder.length === currentOrder.length &&
      expectedOrder.every((title, index) => title === currentOrder[index]);

    if (
      orderMatches &&
      groups.length === profile.groups.length &&
      dashboardHeader?.dataset.nettapProfile === profile.key
    ) return;

    dashboardHeader?.remove();
    for (const group of groups) {
      group.querySelectorAll('button[role="listitem"]').forEach((button) =>
        list.append(button)
      );
      group.remove();
    }
    list.classList.add("nettap-grouped-suggestions");
    const intro = document.createElement("div");
    intro.className = "nettap-suggestion-dashboard-intro";
    intro.dataset.nettapProfile = profile.key;
    intro.innerHTML = `
      <strong>${profile.heading}</strong>
      <span>${profile.description}</span>
    `;
    list.append(intro);
    let renderedCount = 0;
    for (const group of profile.groups) {
      const available = group.titles
        .filter((title) => byTitle.has(title))
        .slice(0, 6 - renderedCount);
      if (!available.length) continue;

      const panel = document.createElement("section");
      panel.className = "nettap-suggestion-group";
      panel.setAttribute("aria-label", group.label);
      const heading = document.createElement("div");
      heading.className = "nettap-suggestion-group-title";
      heading.setAttribute("role", "heading");
      heading.setAttribute("aria-level", "3");
      heading.textContent = group.label;
      const description = document.createElement("p");
      description.className = "nettap-suggestion-group-description";
      description.textContent = group.description;
      const items = document.createElement("div");
      items.className = "nettap-suggestion-group-items";
      available.forEach((title) => items.append(byTitle.get(title)));
      renderedCount += available.length;
      panel.append(heading, description, items);
      list.append(panel);
    }
  }

  function decorateReports() {
    document
      .querySelectorAll(
        '.chat-assistant.markdown-prose #response-content-container'
      )
      .forEach((container) => {
        if (!container.querySelector("h3, table")) return;
        container.classList.add("nettap-report");

        const firstParagraph = container.querySelector("p");
        if (
          firstParagraph?.textContent
            ?.trim()
            .toLowerCase()
            .startsWith("executive summary")
        ) {
          firstParagraph.classList.add("nettap-executive-summary");
        }

        container.querySelectorAll("td").forEach((cell) => {
          const value = cell.textContent?.trim().toLowerCase();
          if (["critical", "high", "medium", "low"].includes(value)) {
            cell.classList.add(`nettap-severity-${value}`);
          }
        });
      });
  }

  function apply() {
    setDocumentBrand();
    applyAuthBranding();
    applyChatBranding();
    decorateReports();
    organizeSuggestions();
  }

  let applyScheduled = false;

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;

    window.requestAnimationFrame(() => {
      applyScheduled = false;
      apply();
    });
  }

  const observer = new MutationObserver(scheduleApply);

  function start() {
    apply();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
