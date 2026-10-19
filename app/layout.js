export const metadata = {
  title: 'Shadow License Server',
  description: 'License Management System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ background: '#0a0a0a', margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
