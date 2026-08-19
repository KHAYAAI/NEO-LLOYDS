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

### 2. A Terraform state backend
`infrastructure/aws/terraform/versions.tf` has the S3+DynamoDB backend
block commented out. Create that bucket and table first (`terraform init`
with local state, once, is fine for the very first apply — don't leave it
that way).

### 3. Fill in `terraform.tfvars`
Copy `terraform.tfvars.example`. Most values are placeholders until step 4
runs once; `domain_name` and the WorkOS Production variables stay
commented out until you have a real domain (see apps/admin-portal/README.md
— the WorkOS Production environment already exists but was deliberately
left unconfigured for the same reason).

### 4. Wire GitHub Actions to AWS (for `build-and-push.yml`)
Create an IAM role trusting GitHub's OIDC provider (`token.actions.githubusercontent.com`),
scoped to `ecr:*` on the `neo-lloyds/*` repositories this stack creates,
then set two repo secrets: `AWS_ROLE_ARN`, `AWS_REGION`. No long-lived AWS
access keys — OIDC federation is the current AWS-recommended pattern and
avoids a static credential existing anywhere at all.

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

### 7. Real settlement, KYB/KYC, sanctions screening
Unchanged from `docs/security-model.md` §8: these need signed vendor
contracts and live API keys this repository cannot obtain on your behalf.
The `SettlementProvider`/`KybProvider`/`SanctionsProvider` interfaces are
built and ready for a real adapter class the moment you have one.

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
