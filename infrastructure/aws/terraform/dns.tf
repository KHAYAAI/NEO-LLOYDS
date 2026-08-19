# Everything in this file only exists once var.domain_name is set. This is
# not a placeholder half-measure -- it mirrors exactly the decision already
# made for WorkOS Production in apps/admin-portal/README.md: guessing a
# domain now would mean either a fake certificate request that AWS will
# reject, or a real one for a domain nobody owns yet. Both are worse than
# an HTTPS listener that plainly doesn't exist until you have a domain to
# point it at.
#
# Prerequisite this repository cannot do for you: the domain itself must
# already be registered and its zone either hosted in Route53 already, or
# you must be ready to point its nameservers at the zone this creates.

resource "aws_route53_zone" "this" {
  count = var.domain_name != null ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "this" {
  count                     = var.domain_name != null ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = [for p in local.portals : "${p.host}.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.domain_name != null ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = aws_route53_zone.this[0].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "this" {
  count                   = var.domain_name != null ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  count             = var.domain_name != null ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this[0].certificate_arn

  # No default action other than the API -- portals get host-based rules
  # below. An unmatched Host header falls through to the API, which is a
  # reasonable default (it 404s cleanly) rather than an arbitrary choice.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener_rule" "portal" {
  for_each     = var.domain_name != null ? local.portals : {}
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100 + index(keys(local.portals), each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.portal[each.key].arn
  }

  condition {
    host_header {
      values = ["${each.value.host}.${var.domain_name}"]
    }
  }
}

resource "aws_route53_record" "api" {
  count   = var.domain_name != null ? 1 : 0
  zone_id = aws_route53_zone.this[0].zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "portal" {
  for_each = var.domain_name != null ? local.portals : {}
  zone_id  = aws_route53_zone.this[0].zone_id
  name     = "${each.value.host}.${var.domain_name}"
  type     = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
