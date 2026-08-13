export const metadata = { title: "Privacy Policy — WiserFiles" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Privacy Policy</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>Last updated: {new Date().toLocaleDateString()}</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>1. Information We Collect</h2>
      <p>We collect information you provide (account details, documents you upload, project content) and basic usage data (pages visited, features used) to operate and improve the service.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>2. How We Use Information</h2>
      <p>We use your information to provide the service, sync your projects across devices, send collaboration invitations you request, and improve functionality.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>3. Document Content</h2>
      <p>Your documents and project content are stored securely and are not sold or shared with third parties. Project content is only accessible to you and the collaborators you invite.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>4. AI Features</h2>
      <p>When you use AI writing or review features, the selected text is sent to our AI provider (DeepSeek) to generate responses. The content is processed transiently and not used to train models.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>5. Analytics</h2>
      <p>We collect aggregated, anonymized usage analytics to understand feature adoption. We do not sell this data.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>6. Data Security</h2>
      <p>We use industry-standard measures to protect your data, including encryption in transit and access controls.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>7. Your Rights</h2>
      <p>You may request access to, correction of, or deletion of your personal data by contacting us.</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 8px" }}>8. Contact</h2>
      <p>Privacy inquiries can be directed to <a href="mailto:johnsjdsd@gmail.com" style={{ color: "#0f766e" }}>johnsjdsd@gmail.com</a>.</p>
    </main>
  );
}
