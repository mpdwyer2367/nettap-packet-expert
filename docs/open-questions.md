# Open questions and external dependencies

1. Which documented NetTAP device APIs, authentication methods, models, and firmware versions are authorized for the first read-only adapter?
2. Which customer identity provider and supported Open WebUI identity contract will provide user, role, case, and device authorization?
3. Which parser image and TShark/Zeek versions may be redistributed, and what licensing notices are required?
4. What evidence-retention, legal-hold, deletion, payload-masking, and encryption-at-rest policies must be enforced per customer?
5. What is the approved canonical schema for DNS transactions, TLS sessions, alerts, findings, approvals, and reports?
6. Which exact macOS, Windows/WSL2, and Linux versions form the evaluation support matrix?
7. Where will signed model, appliance, update, and offline-activation artifacts be stored?
8. What hardware and representative datasets will be used to publish measured ingest, analysis, storage, backup, and response limits?

Until these questions are resolved, the repository must not claim real device support,
enterprise authorization, PCAPNG production support, production certification, or commercial approval.
