(() => {
  "use strict";

  const experience = document.documentElement.dataset.experience;
  const local = window.location.port === "3000" || window.location.port === "3001";
  const host = window.location.hostname || "127.0.0.1";
  const protocol = window.location.protocol;

  const localUrl = (port, path = "/") => `${protocol}//${host}:${port}${path}`;
  const switchUrl = local
    ? localUrl(experience === "visibility" ? "3001" : "3000")
    : experience === "visibility" ? "/packet-expert/" : "/visibility/";
  const sharedUrl = local ? localUrl("3100") : "/";
  const evidenceUrl = local ? localUrl("3200") : "/evidence/";

  document.querySelectorAll("[data-switch-experience]").forEach((link) => { link.href = switchUrl; });
  document.querySelectorAll("[data-shared-app]").forEach((link) => { link.href = sharedUrl; });
  document.querySelectorAll("[data-evidence-app]").forEach((link) => { link.href = evidenceUrl; });

  const status = document.getElementById("runtime-status");
  if (!status) return;

  fetch(local ? "/system/health" : "/system/health", { cache: "no-store", credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error("health check failed");
      status.dataset.state = "ready";
      status.querySelector("span").textContent = "Application ready";
    })
    .catch(() => {
      status.dataset.state = "unavailable";
      status.querySelector("span").textContent = "Application starting or unavailable";
    });
})();
