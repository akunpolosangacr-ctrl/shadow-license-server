export const metadata = {
  title: 'Shadow License Server',
  description: 'License Management Panel',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0a0a0a', color: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
