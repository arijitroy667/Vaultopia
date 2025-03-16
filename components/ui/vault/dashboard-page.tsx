"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WalletConnect } from "@/components/ui/wallet/wallet-connect"
import { VaultStats } from "@/components/ui/vault/vault-stats"
import { DepositSection } from "@/components/ui/vault/deposit-section"
import { WithdrawSection } from "@/components/ui/vault/withdraw-section"
import { TransactionHistory } from "@/components/ui/vault/transaction-history"
import { AdminPanel } from "@/components/ui/vault/admin-panel"
import { useWallet } from "@/context/wallet-context"
import { useVault } from "@/context/vault-context"

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("dashboard")
  const { isConnected, isAdmin } = useWallet()
  const { vaultData } = useVault()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between py-4">
          <h1 className="text-2xl font-bold">DeFi Vault</h1>
          <WalletConnect />
        </div>
      </header>
      <main className="container py-6">
        {isConnected ? (
          <>
            <VaultStats />
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="deposit">Deposit & Mint</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw & Redeem</TabsTrigger>
                <TabsTrigger value="history">Transaction History</TabsTrigger>
              </TabsList>
              <TabsContent value="dashboard" className="mt-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <DepositSection />
                  <WithdrawSection />
                </div>
              </TabsContent>
              <TabsContent value="deposit" className="mt-6">
                <DepositSection />
              </TabsContent>
              <TabsContent value="withdraw" className="mt-6">
                <WithdrawSection />
              </TabsContent>
              <TabsContent value="history" className="mt-6">
                <TransactionHistory />
              </TabsContent>
            </Tabs>
            {isAdmin && (
              <div className="mt-10">
                <h2 className="text-xl font-bold mb-4">Admin Controls</h2>
                <AdminPanel />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-8 text-center max-w-md">
              Connect your wallet to interact with the DeFi Vault. Deposit funds, mint shares, and track your
              investments.
            </p>
            <WalletConnect />
          </div>
        )}
      </main>
    </div>
  )
}

