export const metadata = {
  title: 'Shadow License Server',
  description: 'License Server Management',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0a0a0a' }}>
        {children}
      </body>
    </html>
  );
}
