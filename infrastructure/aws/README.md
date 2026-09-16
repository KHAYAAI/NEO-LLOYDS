# Neo-Lloyds on AWS

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

This directory is real, buildable infrastructure-as-code — not a sketch.
It was written and syntax-checked (`terraform fmt`) in a sandbox with no
Docker daemon and no network access to `registry.terraform.io`, so it has
**not** been built, `terraform plan`'d, `terraform apply`'d, or run against
a real AWS account. Everything below states plainly what's verified vs.
what still needs a real account to prove.

## What's here

```
apps/api/Dockerfile                   Multi-stage build for the API (also
                                       doubles as the migration task image)
infrastructure/aws/portal.Dockerfile  One Dockerfile, all five portals
                                       (--build-arg PORTAL=<name>)
infrastructure/aws/terraform-bootstrap/  Run FIRST, local state: the S3
                                       state bucket, DynamoDB lock table,
                                       and the GitHub->AWS OIDC deploy role
infrastructure/aws/terraform/         The AWS stack: VPC, RDS Postgres,
                                       ElastiCache Redis, S3 (evidence),
                                       ECR, ECS Fargate (API + 5 portals),
                                       ALB + WAF, Secrets Manager, optional
                                       Route53/ACM/CloudFront-free HTTPS
.github/workflows/build-and-push.yml  Builds + pushes all 6 images to ECR
                                       on merge to main (skipped until
                                       configured, not deployment)
.github/workflows/security-scan.yml   Manual-trigger Shannon scan against a
                                       staging URL you provide (skipped
                                       until configured)
```

## What's verified vs. not

**Verified for real, in this repo, this session:**
- `next build` succeeds with `output: 'standalone'` enabled in every
  portal's `next.config.mjs`, and the resulting
  `.next/standalone/apps/<portal>/server.js` path `portal.Dockerfile`
  copies and runs is the actual path a real build produces (inspected
  directly, not assumed).
- `terraform fmt` passes on every file — syntactically valid HCL.
- The `@keygraph/shannon` npm package is real (`npm view` confirms
  version 2.5.2) and its README's `setup` / `start -u <url> -r <repo>`
  usage was fetched and quoted directly, not guessed — an earlier draft
  of `security-scan.yml` had the wrong package name
  (`@keygraphhq/shannon`) and wrong flags before this check caught it.

**Not verified — needs a real AWS account and Docker daemon:**
- `docker build` was never run (no Docker daemon in the authoring
  sandbox) — the Dockerfiles follow documented npm-workspaces + Prisma +
  Next.js `standalone` conventions correctly, but the first real build is
  the first real proof.
- `terraform init`/`plan`/`apply` were never run (`registry.terraform.io`
  was unreachable from the authoring sandbox, for both the AWS provider
  and, initially, a community VPC module — the VPC was rewritten as
  hand-rolled native resources specifically to remove that external
  dependency, not just to work around the sandbox).
- The Shannon workflow's `setup` step is documented as interactive; it
  may need flags (not shown in the README as fetched) to run
  non-interactively in CI with `ANTHROPIC_API_KEY` pre-set. Confirm this
  before trusting the workflow to complete unattended.

## The launch-readiness checklist — what needs you

Everything in this section is an account, a credential, a domain, or a
decision only you can make. Nothing here is a code gap I didn't get to.

### 1. An AWS account, and someone with permission to create resources in it
Nothing below works without this. Recommended: a dedicated AWS account
(or at minimum a dedicated IAM role) for Neo-Lloyds, not a shared personal
account — makes the SOC 2 access-review story much simpler later.

### 2. Terraform state backend + GitHub OIDC deploy role
Both are now real Terraform, not just described — `infrastructure/aws/terraform-bootstrap/`
creates the S3 state bucket, the DynamoDB lock table, and the GitHub →
AWS OIDC role `build-and-push.yml` needs, scoped narrowly to
`ecr:*` on `neo-lloyds/*` only and to one repo/branch via the OIDC trust
condition — no long-lived AWS access keys anywhere. **Not yet run**: the
AWS connector available in this session needs you to re-authorize it
(`/mcp` or your connector settings) before anything here can actually
apply. Once it's live:
```bash
cd infrastructure/aws/terraform-bootstrap
terraform init
terraform apply -var="github_repo=KHAYAAI/NEO-LLOYDS"
```
Take the `github_deploy_role_arn` output and set it as the `AWS_ROLE_ARN`
repo secret (also set `AWS_REGION`) — that closes out
`.github/workflows/build-and-push.yml`. Then uncomment the `backend "s3"`
block in `infrastructure/aws/terraform/versions.tf` (the bucket/table
names already match what bootstrap creates) before the first real apply
of the main stack.

### 3. Fill in `terraform.tfvars`
Copy `terraform.tfvars.example`. Most values are placeholders until step 5
runs once; `domain_name` and the WorkOS Production variables stay
commented out until you have a real domain (see apps/admin-portal/README.md
— the WorkOS Production environment already exists but was deliberately
left unconfigured for the same reason).

### 5. First deploy, in order
```bash
cd infrastructure/aws/terraform
terraform init
terraform apply   # creates VPC/RDS/Redis/S3/ECR/ECS/ALB/WAF, but ECS
                   # services will crash-loop until images exist -- expected
# push to main, or run the build-and-push workflow manually, so real
# images land in the ECR repos terraform just created
aws ecs run-task --cluster <ecs_cluster_name output> \
  --task-definition neo-lloyds-<env>-migrate ...   # run the DB migration once
terraform apply   # re-apply if api_image/portal_images vars changed to real tags
```

### 6. A real domain (when you have one)
Uncomment `domain_name` in `terraform.tfvars`, `terraform apply` — this
creates the Route53 zone, ACM certificate, HTTPS listener, and per-portal
host-based routing rules that don't exist yet. Point the domain's
registrar at the zone's nameservers (a `terraform output` value). Then
also update the WorkOS Production environment's redirect/logout/CORS URIs
(apps/admin-portal/README.md has the exact `setRedirectUris` pattern
already used for Staging) and set `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
per-portal accordingly.

### 7. Real settlement, KYB/KYC, sanctions screening — now partially done
`SettlementProvider` (Stripe Connect Transfers), `KybProvider` and
`SanctionsProvider` (both Didit) all have real adapters now, not just
interfaces waiting for one — see `docs/security-model.md` §8 for exactly
what each does and doesn't cover. What's still needed from you: a real
Stripe account with `STRIPE_API_KEY` set, and — separately — a way to
onboard each capital provider onto Stripe Connect so a real
`destinationAccountId` exists to pay out to (nothing in Neo-Lloyds does
that yet). `STABLECOIN` settlement and Didit's Bank Verification add-on
(confirmed live to be disabled on the connected account) remain
unbuilt/unavailable.

### 8. A real penetration test
`security-scan.yml` (Shannon) is a genuine, real automated scanner — not
a placeholder — but per its own README it is explicitly **not** a
substitute for an independent third-party pentest, which SOC 2 Type II
and most enterprise security questionnaires expect specifically. Budget
for both: Shannon continuously between engagements, a real firm annually
(or before each major release).

### 9. SOC 2 / PCI DSS
Not infrastructure-as-code problems — see the platform overview given
earlier in this conversation. SOC 2 is an audit of operational controls
over 6–12 months of real production operation, not a one-time build step.
PCI scope depends on a decision (route settlement through a tokenizing
processor like Stripe, don't touch card data directly) that should be
made before, not after, building the real `SettlementProvider` adapter in
item 7.

### 10. Rotate the WorkOS Production secret key
Flagged already in `apps/admin-portal/README.md`: a real secret was
pasted into a chat session during this work. Treat it as compromised.
