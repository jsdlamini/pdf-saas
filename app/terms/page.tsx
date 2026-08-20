export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Terms of Service</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>Last updated: {new Date().toLocaleDateString()}</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>1. Acceptance of Terms</h2>
      <p>By accessing or using WiserFiles, you agree to be bound by these Terms of Service. If you do not agree, please do not use the service.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>2. Description of Service</h2>
      <p>WiserFiles provides document tools including PDF conversion, OCR, and a research studio for LaTeX, Python, and C++ authoring. The service is provided &quot;as is&quot; and may change over time.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>3. User Accounts</h2>
      <p>Some features require an account. You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>4. Acceptable Use</h2>
      <p>You agree not to misuse the service, including attempting to gain unauthorized access, uploading malicious content, or using the service to violate any law.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>5. Intellectual Property</h2>
      <p>You retain ownership of the documents you create and upload. By using the service, you grant us a limited license to process your content solely to provide the service.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>6. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, WiserFiles is not liable for indirect, incidental, or consequential damages arising from use of the service.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>7. Termination</h2>
      <p>We may suspend or terminate access to the service at any time for violations of these terms or other legitimate reasons.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>8. Contact</h2>
      <p>Questions about these terms can be directed to <a href="mailto:johnsjdsd@gmail.com" style={{ color: "#0f766e" }}>johnsjdsd@gmail.com</a>.</p>
    </main>
  );
}
