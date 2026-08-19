data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# Hand-rolled rather than a community registry module: no external
# dependency to trust or to fetch at `terraform init` time (this
# repository's own build sandbox had no network access to
# registry.terraform.io, which is exactly the kind of restricted network a
# CI runner or an air-gapped review environment might also have).

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "neo-lloyds-${var.environment}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "neo-lloyds-${var.environment}" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, 8 + count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "neo-lloyds-${var.environment}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone = local.azs[count.index]
  tags              = { Name = "neo-lloyds-${var.environment}-private-${count.index}" }
}

resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, 12 + count.index)
  availability_zone = local.azs[count.index]
  tags              = { Name = "neo-lloyds-${var.environment}-database-${count.index}" }
}

resource "aws_eip" "nat" {
  count  = var.environment == "production" ? 2 : 1
  domain = "vpc"
  tags   = { Name = "neo-lloyds-${var.environment}-nat-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count         = var.environment == "production" ? 2 : 1
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "neo-lloyds-${var.environment}-${count.index}" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "neo-lloyds-${var.environment}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# One NAT for staging (cost), one per AZ for production (no single point
# of failure for outbound egress from private subnets).
resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.environment == "production" ? count.index : 0].id
  }
  tags = { Name = "neo-lloyds-${var.environment}-private-${count.index}" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}
