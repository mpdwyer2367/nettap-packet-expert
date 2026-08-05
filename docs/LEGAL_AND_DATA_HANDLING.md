# Legal notice and packet-capture data handling

> **Counsel review required.** This document is an operational template, not legal advice and not a substitute for terms approved by qualified counsel. No disclaimer can prevent every claim or guarantee immunity from legal action. Binding limitations, customer obligations, indemnities, venue, governing law, privacy terms, and data-processing obligations should be placed in an executed agreement or properly presented electronic terms appropriate to the applicable jurisdiction.

## Authorized-use condition

NetTAP Packet Expert is provided solely for lawful, authorized network engineering, security monitoring, troubleshooting, incident response, and forensic activities. Use does not grant authority to intercept, collect, inspect, retain, decrypt, disclose, or transfer communications or data. The user and deploying organization are responsible for obtaining all required ownership rights, consents, approvals, notices, warrants, contractual permissions, and regulatory authority before acquisition or analysis.

The assistant must not be used to evade access controls, privacy requirements, employment rules, contractual duties, monitoring notices, evidence-preservation duties, or applicable law. If authorization, ownership, or permissible scope is uncertain, collection and analysis must pause pending review by the designated NetTAP manager, security or privacy function, data owner, and legal counsel as required by internal process.

## Packet captures are sensitive by default

PCAP and PCAPNG files can contain personal information, sensitive personal information, credentials, authentication material, session identifiers, cookies, email and message content, browsing activity, hostnames, IP and MAC addresses, customer data, proprietary application content, protected health or financial information, security weaknesses, and regulated or confidential information. Encryption does not make all metadata non-sensitive.

Treat every packet capture and packet-derived artifact as **NetTAP Confidential — Restricted Security Data** unless the authorized data owner assigns another classification in writing. This classification applies to original captures, filtered captures, decoded text, screenshots, exports, extracted objects, hashes associated with an investigation, model inputs and outputs, and reports.

## Prohibited disclosure and transfer

Packet captures and packet-derived sensitive information must not be:

- emailed to personal accounts, customers, vendors, consultants, or any other outside party;
- placed in consumer file-sharing, messaging, collaboration, paste, public-repository, or unapproved cloud services;
- submitted to externally hosted AI, analysis, malware-scanning, or support services;
- copied to unmanaged devices, removable media, or locations outside the approved case repository; or
- disclosed internally to personnel without a documented need to know.

External transfer is permitted only when the internal corporate process has been completed and the transfer is specifically approved in writing by the authorized data owner and the required NetTAP security, privacy, management, and legal representatives. Use only the approved encrypted transfer channel, named recipients, minimum necessary data, expiration, access logging, retention, and deletion terms. Email attachments are not an approved transfer mechanism unless a written exception expressly authorizes the specific transfer and protection method.

## Minimum handling controls

1. Record the business purpose, authority, data owner, collector, observation point, scope, time window, filter, snap length, retention, and approved users before capture.
2. Collect the minimum evidence necessary. Prefer headers, metadata, masking, slicing, and narrow filters when payload is unnecessary.
3. Store captures only in an approved encrypted repository with least-privilege access, multifactor authentication where available, audit logging, and backups appropriate to the classification.
4. Preserve originals as read-only when evidence may support an investigation. Record SHA-256 hashes, timestamps including timezone, custody transfers, tool versions, commands, transformations, and derived files.
5. Do not place raw credentials, secrets, personal content, or unnecessary payload in an LLM context. Redact or tokenize sensitive values before model use.
6. Apply the approved retention schedule, legal holds, incident-response plan, privacy requirements, and secure-deletion process. Do not delete evidence subject to a hold.
7. Report suspected loss, misdelivery, unauthorized access, or disclosure immediately through the internal incident and privacy process. Do not investigate or notify external parties independently unless authorized.

## Assistant limitations and user responsibility

NetTAP Packet Expert is an analytical aid. It can be incomplete, inaccurate, or affected by missing traffic, capture artifacts, model limitations, incorrect context, or outdated information. Its output is not legal advice, a legal conclusion, a compliance certification, an expert opinion, a warranty, or a substitute for qualified packet analysts, incident responders, privacy professionals, or counsel.

The assistant must not determine that monitoring is lawful, that consent is sufficient, that evidence is admissible, that a breach notification is required, or that a person or organization is liable. It may identify an issue requiring review and direct the user to the approved internal function.

Users remain responsible for validating evidence, protecting data, obtaining approvals, assessing third-party rights, and reviewing every operational or security action before execution. Production changes, containment, blocking, disclosure, customer communication, law-enforcement contact, and legal conclusions require authorized human decision-makers.

## Warranty and liability language for counsel review

To the maximum extent permitted by applicable law and subject to controlling written agreements, the software, model definitions, prompts, Skills, knowledge materials, and outputs are provided **“as is” and “as available,” without warranties of any kind**, whether express, implied, or statutory, including warranties of accuracy, completeness, merchantability, fitness for a particular purpose, title, non-infringement, uninterrupted operation, security, or suitability for evidentiary, legal, regulatory, or production use.

To the maximum extent permitted by applicable law and subject to controlling written agreements, NetTAP Technology and its affiliates, officers, directors, employees, contractors, licensors, and suppliers will not be liable for indirect, incidental, special, exemplary, punitive, or consequential damages, loss of data, loss of revenue, loss of profits, business interruption, security incidents, privacy claims, evidentiary consequences, or costs arising from use of or reliance on the project or its outputs, even if advised of the possibility. Any enforceable aggregate-liability cap, exclusions, remedies, governing law, venue, dispute process, and indemnity must be established by qualified counsel in the applicable contract; this repository does not create those terms by itself.

Nothing in this notice excludes liability that cannot legally be excluded, modifies an executed agreement, grants a license beyond the applicable license terms, or waives any NetTAP Technology right or remedy.

## Operational references

- NIST SP 800-61 Rev. 3, *Incident Response Recommendations and Considerations for Cybersecurity Risk Management*.
- NIST guidance on safeguarding incident data, restricting access, documenting handling, and coordinating evidence procedures with legal staff.
- California Department of Justice guidance describing personal and sensitive personal information under the CCPA, as amended.

The deploying organization must identify all additional laws, contracts, sector rules, employment requirements, data-residency restrictions, and customer instructions applicable to its environment.
