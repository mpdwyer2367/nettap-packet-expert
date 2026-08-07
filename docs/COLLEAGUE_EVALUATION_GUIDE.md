# Colleague evaluation guide

This is a controlled evaluation of `0.3.0-rc.7`, not production approval.

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
git rev-parse HEAD
./tests/static-checks.sh
./scripts/nettap-ai start-local
./tests/colleague-macos-acceptance.sh
```

Open <http://127.0.0.1:3100>, complete generated-password activation and confirm the combined assistant is selected. Test a visibility/design question, a network troubleshooting question, and authorized representative PCAP/log/normalized-flow attachments. Verify evidence IDs, hashes, quality limitations and evidence-supported hypotheses. Confirm ports 3000, 3001 and 3200 are not published.

Save the exact commit, host/Docker versions, image/model identities, verification reports, browser results, backup/restore/rollback results and exceptions. Never include credentials or customer evidence in a public issue.
