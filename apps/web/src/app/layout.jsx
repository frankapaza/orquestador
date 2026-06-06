import './globals.css'

export const metadata = {
  title: 'Kubo Orquestador',
  description: 'Plataforma de envio masivo de correos',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
