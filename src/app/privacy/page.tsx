import ReactMarkdown from "react-markdown";

const privacyContent = `# Spine Privacy Policy

**Last Updated: February 19, 2026**

## Introduction

Spine ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and web service (collectively, the "Service").

## Information We Collect

### Information You Provide
- **Account Information:** Email address, name (via GitHub authentication)
- **Financial Data:** Bank account information, transaction history (via Plaid)
- **Health Data:** Sleep hours, heart rate variability (HRV), activity levels (from iOS Health app via manual sync)

### Automatically Collected Information
- **Usage Data:** Pages visited, features used, time spent on Service
- **Device Information:** Browser type, operating system, IP address
- **Cookies:** We use essential cookies for authentication and session management

## How We Use Your Information

We use your information to:
- Provide and maintain the Service
- Analyze correlations between health metrics and spending patterns
- Calculate behavioral risk scores and generate personalized insights
- Improve and optimize the Service
- Communicate with you about your account and Service updates
- Ensure security and prevent fraud

## Data Sharing and Disclosure

### Third-Party Service Providers

We share data with the following service providers:

**Plaid, Inc.**
- Purpose: Bank account connection and transaction data retrieval
- Data Shared: Bank credentials (encrypted by Plaid), transaction history
- Privacy Policy: https://plaid.com/legal/

**Supabase (PostgreSQL Database Hosting)**
- Purpose: Data storage and authentication
- Data Shared: All user data (encrypted at rest)
- Privacy Policy: https://supabase.com/privacy

**Vercel (Hosting)**
- Purpose: Web application hosting
- Data Shared: Usage logs, IP addresses
- Privacy Policy: https://vercel.com/legal/privacy-policy

### We Do NOT:
- Sell your personal information to third parties
- Share your financial or health data with advertisers
- Use your data for purposes other than providing the Service

## Data Security

We implement industry-standard security measures:
- Encryption in transit (TLS 1.2+)
- Encryption at rest for all stored data
- Row-level security policies on database
- Multi-factor authentication for administrative access
- Regular security updates and monitoring

However, no method of transmission over the Internet is 100% secure. We cannot guarantee absolute security.

## Your Rights and Choices

### Access and Correction
You can access and update your information through your account settings.

### Data Deletion
You may request deletion of your account and all associated data by emailing husseinabdou06@gmail.com. We will process deletion requests within 30 days.

### Opt-Out
You can disconnect your bank account or stop syncing health data at any time through the app settings.

### Do Not Track
We do not respond to Do Not Track (DNT) signals.

## Data Retention

We retain your data for as long as your account is active or as needed to provide the Service. After account deletion:
- Personal data is deleted within 30 days
- Aggregated, anonymized data may be retained for analytics
- Financial transaction data is retained for 90 days for fraud prevention, then deleted

See our Data Retention and Deletion Policy for full details.

## Children's Privacy

Spine is not intended for users under 18 years of age. We do not knowingly collect personal information from children. If we discover we have collected information from a child, we will delete it immediately.

## International Users

Spine is operated from the United States. If you are accessing the Service from outside the U.S., your data will be transferred to and stored in the United States. By using the Service, you consent to this transfer.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify you of material changes by:
- Posting the new policy on this page
- Updating the "Last Updated" date
- Sending an email notification (for significant changes)

Your continued use of the Service after changes constitutes acceptance of the updated policy.

## California Privacy Rights (CCPA)

If you are a California resident, you have the right to:
- Know what personal information is collected
- Know whether personal information is sold or disclosed
- Opt-out of the sale of personal information (Note: We do not sell personal information)
- Request deletion of personal information
- Not be discriminated against for exercising these rights

To exercise these rights, contact us at husseinabdou06@gmail.com.

## Contact Us

If you have questions about this Privacy Policy, please contact:

**Hussein Abdou**
Email: husseinabdou06@gmail.com

## Consent

By using Spine, you consent to this Privacy Policy and our collection and use of information as described herein.

---

**Effective Date:** February 19, 2026`;

export default function PrivacyPage() {
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
          {privacyContent}
        </ReactMarkdown>
      </article>
    </div>
  );
}
