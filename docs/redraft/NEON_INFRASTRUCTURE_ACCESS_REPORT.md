# Neon Infrastructure Access Report

Date: 2026-07-11

## Outcome

**FAIL — authenticated Neon control-plane access has not been restored.**

## Available authentication methods

No usable Neon control-plane authentication method is available in this engineering environment.

- PostgreSQL credentials exist only for the failed validation target. They do not authorize branch inventory, lineage inspection, or branch creation.
- The repository is known to have a GitHub `NEON_API_KEY` secret, but its value is intentionally unreadable and it is not local manual authorization.

## Missing authentication methods

- Local `NEON_API_KEY` / Neon personal access token
- Installed Neon CLI
- Authenticated Neon CLI profile
- Accessible authenticated Neon Dashboard session
- Confirmed Neon organization-owner or project-owner session
- Service-account credentials available to this environment

An attempt to inspect an existing in-app browser session could not proceed because the trusted browser bridge was unavailable. No dashboard action was performed.

## Required permissions

The minimum authorized identity must be able to:

- Read project `icy-field-51189449`
- List branches and retrieve branch name, ID, parent, creation time, and branch point
- Read endpoints, databases, and roles without exposing secrets in reports
- Create a disposable child from the approved non-production source branch
- Retrieve pooled and direct connection details for that child
- Delete the disposable child after certification

It must not require production mutation authority beyond reading branch inventory needed to prove isolation.

## Minimum credential required

Either:

1. An owner-operated authenticated Neon Dashboard session that performs the branch inventory and child creation while recording non-secret lineage evidence; or
2. A temporary, least-privilege Neon personal access token exposed locally as `NEON_API_KEY`, with project-read, branch-create/read/delete, endpoint-read, and connection-detail permissions.

The token must not be committed, printed, logged, pasted into reports, or stored after recovery.

## Recommended recovery path

The fastest legitimate path is owner-operated Neon Dashboard recovery because it avoids distributing another secret. The owner should identify the canonical non-production source, verify its migration/schema baseline read-only, create the disposable child, and provide the non-secret lineage record plus pooled/direct child credentials through `.env.trade-validation`.

If engineering must perform the control-plane work, supply a temporary least-privilege `NEON_API_KEY`, install/authenticate Neon CLI or use the Neon API, complete Validation Environment Recovery, and immediately remove the token.

## Next step after access restoration

Resume **Validation Environment Recovery**. Do not begin Trade P0 physical testing until the canonical source and new disposable child pass all three recovery stop gates.

No databases, branches, migrations, schemas, fixtures, Trade OS tests, or Renewal work were created or modified during this access investigation.
