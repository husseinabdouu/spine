import ReactMarkdown from "react-markdown";

const securityContent = `# Spine Information Security Policy (ISP)

**Last Updated: February 19, 2026**

## 1. Purpose and Scope

This Information Security Policy establishes the framework for protecting Spine's information assets, including user data, application code, and infrastructure. This policy applies to all systems, applications, and personnel involved in the development and operation of Spine.

## 2. Information Security Objectives

Spine is committed to:
- **Confidentiality:** Protecting user financial and health data from unauthorized access
- **Integrity:** Ensuring data accuracy and preventing unauthorized modification
- **Availability:** Maintaining reliable access to the service for authorized users
- **Compliance:** Meeting all applicable legal and regulatory requirements

## 3. Roles and Responsibilities

### Security Officer
**Hussein Abdou** (Founder/Developer)
- Email: husseinabdou06@gmail.com
- Responsibilities:
  - Overall security program management
  - Security incident response
  - Policy review and updates
  - Vendor security assessment
  - Security monitoring and logging

### Development Team
Currently: Solo founder (may expand in future)
- Secure coding practices
- Code review and testing
- Dependency management
- Security patch implementation

## 4. Data Classification

### Critical Data (Highest Protection)
- Bank account credentials (handled by Plaid, not stored by Spine)
- User authentication tokens
- Plaid API access tokens
- Supabase service role keys

### Sensitive Data (High Protection)
- Financial transaction data
- Health metrics (sleep, HRV, activity)
- User email addresses
- Behavioral risk scores

### Internal Data (Moderate Protection)
- Application logs (sanitized of PII)
- System configuration
- Error reports

### Public Data (Standard Protection)
- Marketing materials
- Public documentation
- Privacy policy

## 5. Access Control

### Authentication
- Multi-factor authentication (MFA) required for:
  - GitHub (development access)
  - Supabase (database admin access)
  - Plaid dashboard
  - Vercel (deployment platform)
  - Domain registrar
  - Email accounts

### User Access Control
- Users authenticate via GitHub OAuth
- Row-level security (RLS) policies enforce data isolation
- Each user can only access their own data
- Service role key used only in trusted API routes

### Administrative Access
- Production database: Access only via Supabase dashboard with MFA
- Deployment: Automated via Vercel CI/CD
- Emergency access: Documented and logged

### Access Reviews
- Quarterly review of administrative access
- Immediate revocation upon role change
- Annual password rotation for service accounts

## 6. Data Protection

### Encryption

**In Transit:**
- TLS 1.2 or higher for all connections
- HTTPS enforced for web application
- Secure WebSocket connections where applicable

**At Rest:**
- Supabase provides AES-256 encryption for all data
- Database backups encrypted
- Plaid credentials encrypted by Plaid (tokenized)

**Application Level:**
- Sensitive configuration in environment variables
- API keys never committed to source code
- Secrets managed via Vercel environment variables

### Data Backup and Recovery
- **Database:** Supabase automatic daily backups (7-day retention)
- **Code:** GitHub version control with branch protection
- **Configuration:** Infrastructure as code documented
- **Recovery Time Objective (RTO):** 4 hours
- **Recovery Point Objective (RPO):** 24 hours

### Data Sanitization
- Personal data removed from logs
- Production data never used in development
- Test data anonymized or synthetic

## 7. Network Security

### Infrastructure
- Hosted on Vercel (SOC 2 compliant infrastructure)
- Database hosted on Supabase (ISO 27001 certified)
- DDoS protection via Vercel Edge Network
- Rate limiting on API endpoints

### Firewall and Access
- Supabase database not publicly accessible
- API routes protected by authentication
- CORS policies restrict cross-origin requests

### Monitoring
- Real-time error tracking
- Database query logging (sanitized)
- Failed authentication attempts logged
- Unusual activity alerts

## 8. Application Security

### Secure Development Lifecycle

**Design Phase:**
- Security requirements documented
- Threat modeling for new features
- Privacy by design principles

**Development Phase:**
- Secure coding guidelines followed
- Input validation on all user inputs
- SQL injection prevention via parameterized queries
- XSS prevention via React automatic escaping
- CSRF protection via SameSite cookies

**Testing Phase:**
- Security testing before deployment
- Dependency vulnerability scanning
- Manual security review of critical features

**Deployment Phase:**
- Automated deployment via CI/CD
- Environment variable validation
- Rollback procedures documented

### Dependency Management
- GitHub Dependabot enabled
- Monthly dependency updates
- Critical security patches within 48 hours
- Automated vulnerability scanning

### Code Security
- Sensitive code not exposed client-side
- API routes validate all inputs
- Rate limiting prevents abuse
- Service role key isolated to server-only code

## 9. Third-Party Risk Management

### Vendor Security Assessment

**Plaid (Financial Data)**
- SOC 2 Type II certified
- Bank-level security (256-bit encryption)
- Regular security audits
- Privacy policy reviewed annually

**Supabase (Database & Auth)**
- ISO 27001 certified
- SOC 2 Type II certified
- Encryption at rest and in transit
- Regular penetration testing

**Vercel (Hosting)**
- SOC 2 Type II certified
- ISO 27001 certified
- DDoS protection included
- 99.99% uptime SLA

### Vendor Monitoring
- Annual vendor security review
- Subscribe to vendor security bulletins
- Immediate response to vendor incidents

## 10. Incident Response

### Security Incident Definition
- Unauthorized access to systems or data
- Data breach or exposure
- Malware or ransomware
- DDoS attack
- Insider threat
- Loss of critical data

### Response Procedures

**Detection (Immediate):**
- Monitor logs and alerts
- User reports via email
- Vendor notifications

**Containment (Within 1 hour):**
- Isolate affected systems
- Revoke compromised credentials
- Block malicious traffic
- Preserve evidence

**Investigation (Within 24 hours):**
- Determine scope and impact
- Identify root cause
- Document findings
- Assess legal obligations

**Notification (Within 72 hours if required):**
- Notify affected users if data breach
- Report to authorities if legally required
- Public disclosure if appropriate
- Vendor notification if applicable

**Recovery (Within 72 hours):**
- Restore from backups if needed
- Apply security patches
- Reset credentials
- Verify system integrity

**Post-Incident (Within 7 days):**
- Root cause analysis
- Update policies and procedures
- Implement preventive measures
- Document lessons learned

### Incident Contact
- Primary: husseinabdou06@gmail.com

## 11. Business Continuity

### Critical Systems
1. Supabase Database
2. Vercel Application Hosting
3. Plaid API Connection
4. GitHub Code Repository

### Backup Locations
- Database: Supabase multi-region backups
- Code: GitHub (remote) + Local development machines
- Configuration: Documented in version control

### Disaster Recovery
- **Scenario 1 - Database Failure:** Restore from Supabase backup (4 hours)
- **Scenario 2 - Application Failure:** Redeploy from GitHub (30 minutes)
- **Scenario 3 - Plaid Outage:** Graceful degradation, cached data displayed
- **Scenario 4 - Complete Infrastructure Loss:** Rebuild on new infrastructure (24 hours)

## 12. Security Training and Awareness

### Development Team (Current: Solo Founder)
- Stay current with OWASP Top 10
- Review security advisories monthly
- Attend security webinars/conferences annually
- Document security learnings

### Future Team Members
- Security onboarding training required
- Annual security refresher training
- Incident response procedures training

## 13. Vulnerability Management

### Vulnerability Scanning
- GitHub Dependabot: Weekly automated scans
- Manual security reviews: Monthly
- Third-party security audit: Annually (when budget allows)

### Patch Management
- **Critical vulnerabilities:** Patched within 48 hours
- **High vulnerabilities:** Patched within 7 days
- **Medium/Low vulnerabilities:** Patched within 30 days
- Emergency patches: Deployed immediately

### Penetration Testing
- Internal testing: Quarterly
- External penetration test: Annually (post-funding)

## 14. Data Privacy and Compliance

### Regulatory Compliance
- **CCPA (California Consumer Privacy Act):** Full compliance
- **GDPR principles:** Privacy by design, user rights respected
- **Plaid requirements:** All security standards met

### Privacy Principles
- Data minimization (collect only what's needed)
- Purpose limitation (use data only as disclosed)
- Transparency (clear privacy policy)
- User control (easy data access/deletion)
- Security by design

### User Rights
- Right to access data
- Right to data portability
- Right to deletion
- Right to opt-out
- Right to non-discrimination

## 15. Acceptable Use

### Prohibited Activities
- Unauthorized access attempts
- Data scraping or harvesting
- Abuse of API rate limits
- Sharing account credentials
- Reverse engineering the application
- Malicious code injection

### Enforcement
- Account suspension for violations
- Legal action for severe violations
- Law enforcement involvement when appropriate

## 16. Policy Governance

### Policy Review
- **Annual review:** February of each year
- **Triggered review:** After security incidents or major changes
- **Approval:** Security Officer (Hussein Abdou)

### Policy Updates
- Version control tracked in GitHub
- Users notified of material changes
- Staff trained on policy changes

### Policy Distribution
- Published at: https://[your-domain]/security-policy
- Available to: All users, partners, and auditors
- Format: Web page, downloadable PDF

### Compliance Monitoring
- Monthly security metrics review
- Quarterly policy compliance check
- Annual third-party assessment (when applicable)

## 17. Contact Information

For security inquiries or to report vulnerabilities:

**Security Officer:** Hussein Abdou
**Email:** husseinabdou06@gmail.com
**Response Time:** Within 24 hours for security issues

**Responsible Disclosure:** We appreciate responsible disclosure of vulnerabilities. Contact us before public disclosure.

---

**Policy Version:** 1.0
**Effective Date:** February 19, 2026
**Next Review Date:** February 19, 2027
**Approved By:** Hussein Abdou, Founder`;

export default function SecurityPolicyPage() {
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
          {securityContent}
        </ReactMarkdown>
      </article>
    </div>
  );
}
