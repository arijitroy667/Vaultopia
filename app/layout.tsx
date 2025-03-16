import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/ui/theme-provider"
import { WalletProvider } from "@/context/wallet-context"
import { VaultProvider } from "@/context/vault-context"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "DeFi Vault",
  description: "A decentralized finance vault for depositing and withdrawing funds",
    generator: 'v0.dev'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <WalletProvider>
            <VaultProvider>
              {children}
              <Toaster />
            </VaultProvider>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}



import './globals.css'