locals {
  # Keyed by the same portal directory names used throughout the repo
  # (apps/<key>). host is the subdomain each portal would be reached at
  # once var.domain_name is set -- unused (and harmless) while it isn't.
  portals = {
    broker-portal       = { image = var.portal_images.broker_portal, host = "broker" }
    capital-portal      = { image = var.portal_images.capital_portal, host = "capital" }
    corporate-portal    = { image = var.portal_images.corporate_portal, host = "corporate" }
    admin-portal        = { image = var.portal_images.admin_portal, host = "admin" }
    claims-admin-portal = { image = var.portal_images.claims_admin_portal, host = "claims-admin" }
  }
}
