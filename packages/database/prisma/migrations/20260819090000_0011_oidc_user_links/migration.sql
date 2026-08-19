-- AlterTable: link a User to an OIDC issuer/subject pair. Both columns are
-- null until an admin explicitly links a human's OIDC identity to a Neo-
-- Lloyds organisation (see IdentityService.provisionOidcUser) -- there is no
-- automatic self-registration.
ALTER TABLE "User" ADD COLUMN "oidcIssuer" TEXT;
ALTER TABLE "User" ADD COLUMN "oidcSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");
