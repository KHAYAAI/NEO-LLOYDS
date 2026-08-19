# Portal -> API calls (every Server Action/Component in every portal --
# see apps/*/src/lib/api.ts) go over private service discovery DNS rather
# than back out through the public ALB: lower latency, no WAF/edge cost on
# purely internal traffic, and it keeps working even if the public
# listener/domain (dns.tf) isn't configured yet.
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = "neo-lloyds-${var.environment}.local"
  vpc  = aws_vpc.this.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
