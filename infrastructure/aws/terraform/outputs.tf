output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.this : k => v.repository_url }
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "rds_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
}

output "route53_nameservers" {
  description = "If var.domain_name was set, point the domain's registrar at these."
  value       = var.domain_name != null ? aws_route53_zone.this[0].name_servers : null
}
