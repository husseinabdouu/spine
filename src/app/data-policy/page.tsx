import ReactMarkdown from "react-markdown";

const retentionContent = `# Spine Data Retention and Deletion Policy

**Last Updated: February 19, 2026**

## Purpose

This Data Retention and Deletion Policy outlines how Spine retains, stores, and deletes user data in compliance with applicable laws and regulations.

## Scope

This policy applies to all personal data collected through the Spine service, including:
- User account information
- Financial transaction data
- Health and wellness metrics
- Usage and analytics data

## Data Retention Periods

### Active Accounts

**Account Information**
- Retention: Duration of account + 30 days after deletion request
- Reason: Provide service, maintain account access

**Financial Transaction Data**
- Retention: 24 months of transaction history
- Reason: Pattern analysis, behavioral insights
- Note: Older transactions automatically archived (read-only) after 24 months

**Health Data**
- Retention: 12 months of health metrics
- Reason: Trend analysis, correlation calculations
- Note: Older health data automatically archived after 12 months

**Behavioral Insights (Risk Scores)**
- Retention: 12 months
- Reason: Historical analysis, algorithm improvement

**Session Logs**
- Retention: 90 days
- Reason: Security monitoring, troubleshooting

### Deleted Accounts

**Personal Identifiable Information (PII)**
- Deletion: Within 30 days of deletion request
- Includes: Email, name, bank connection info, health data, transactions

**Anonymized/Aggregated Data**
- Retention: Indefinite
- Note: Anonymized data cannot be linked back to individual users
- Used for: Product improvement, research, analytics

**Backups**
- Retention: Up to 30 days in backup systems
- Automatic deletion from backups within 30 days

**Legal Hold Data**
- Retention: As required by law or legal process
- Deleted: Once legal obligation ends

## Data Minimization

We collect and retain only data necessary to:
- Provide the behavioral finance service
- Calculate risk scores and insights
- Improve product functionality
- Comply with legal obligations

We do not collect or retain:
- Unnecessary personal information
- Data unrelated to service provision
- Excessive transaction details beyond what's provided by Plaid

## User Data Deletion Rights

### How to Request Deletion

Users can request complete data deletion by:
1. Emailing husseinabdou06@gmail.com with subject "Data Deletion Request"
2. Confirming their identity (email verification)
3. Specifying the data to be deleted (full account vs specific data types)

### Deletion Timeline

- **Acknowledgment:** Within 3 business days
- **Completion:** Within 30 days of request
- **Confirmation:** Email notification when deletion is complete

### What Gets Deleted

Upon account deletion, we delete:
- ✓ Account credentials and profile information
- ✓ Bank connection tokens (Plaid access tokens revoked)
- ✓ All transaction data
- ✓ All health data
- ✓ All behavioral insights and risk scores
- ✓ Usage logs containing personal information

### What May Be Retained (Anonymized)

- Aggregated statistics (e.g., "average users per day")
- Product analytics (anonymized)
- Error logs (with PII removed)

### Exceptions to Deletion

We may retain data when:
- Required by law (e.g., financial regulations, tax records)
- Necessary to resolve disputes or enforce agreements
- Needed to prevent fraud or abuse
- Subject to legal hold or investigation

In these cases, data is isolated, access-restricted, and deleted once the legal obligation ends.

## Data Portability

Users can request a copy of their data:
- **Format:** JSON or CSV
- **Timeline:** Within 30 days
- **Contents:** Account info, transactions, health data, insights
- **Method:** Email husseinabdou06@gmail.com with subject "Data Export Request"

## Third-Party Data Retention

### Plaid
- We do not control Plaid's data retention
- Users must separately request deletion from Plaid: https://plaid.com/legal/data-protection-request-form/
- Revoking bank connection in Spine automatically revokes Plaid access tokens

### Supabase
- Database backups retained for 7 days
- Data deleted from production immediately upon request
- Backup deletion within 7 days

## Security During Retention

While data is retained, we:
- Encrypt data at rest and in transit
- Implement row-level security policies
- Restrict access to authorized personnel only
- Monitor for unauthorized access
- Regularly update security measures

## Policy Updates

We review this policy annually or when:
- Laws or regulations change
- Service functionality changes significantly
- Security practices evolve

Users will be notified of material changes via email.

## Compliance

This policy complies with:
- California Consumer Privacy Act (CCPA)
- General Data Protection Regulation (GDPR) principles
- Payment Card Industry Data Security Standard (PCI DSS) guidelines
- Plaid data protection requirements

## Contact

For questions about data retention or deletion:

**Hussein Abdou**
Email: husseinabdou06@gmail.com

To request data deletion: Email with subject "Data Deletion Request"
To request data export: Email with subject "Data Export Request"

## Audit and Accountability

- Data deletion logs are maintained for 12 months
- Deletion requests are tracked and verified
- Regular audits ensure policy compliance

---

**Effective Date:** February 19, 2026
**Next Review Date:** February 19, 2027`;

export default function DataPolicyPage() {
  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: 40,
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: "#000",
        minHeight: "100vh",
      }}
    >
      <div style={{ marginBottom: 30 }}>
        <a
          href="/dashboard"
          style={{
            color: "#a5b4fc",
            textDecoration: "none",
            fontWeight: "500",
          }}
        >
          ← Back to Dashboard
        </a>
      </div>
      <article
        style={{
          lineHeight: 1.7,
          color: "#e5e5e5",
        }}
      >
        <ReactMarkdown
          components={{
            h1: ({ node, ...props }) => (
              <h1
                style={{ fontSize: 32, marginBottom: 20, color: "#fff" }}
                {...props}
              />
            ),
            h2: ({ node, ...props }) => (
              <h2
                style={{
                  fontSize: 24,
                  marginTop: 30,
                  marginBottom: 15,
                  color: "#fff",
                }}
                {...props}
              />
            ),
            h3: ({ node, ...props }) => (
              <h3
                style={{
                  fontSize: 20,
                  marginTop: 25,
                  marginBottom: 10,
                  color: "#fff",
                }}
                {...props}
              />
            ),
            p: ({ node, ...props }) => (
              <p style={{ marginBottom: 15, color: "#e5e5e5" }} {...props} />
            ),
            ul: ({ node, ...props }) => (
              <ul
                style={{ marginLeft: 20, marginBottom: 15, color: "#e5e5e5" }}
                {...props}
              />
            ),
            li: ({ node, ...props }) => (
              <li style={{ marginBottom: 8, color: "#e5e5e5" }} {...props} />
            ),
            strong: ({ node, ...props }) => (
              <strong style={{ fontWeight: 600, color: "#fff" }} {...props} />
            ),
          }}
        >
          {retentionContent}
        </ReactMarkdown>
      </article>
    </div>
  );
}
