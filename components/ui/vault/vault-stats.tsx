"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useVault } from "@/context/vault-context"
import { ArrowUpRight, TrendingUp, Wallet, Users, BarChart } from "lucide-react"

export function VaultStats() {
  const { vaultData, userShares } = useVault()

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${vaultData.tvl.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-500 flex items-center">
              +{vaultData.tvlChange}%
              <ArrowUpRight className="ml-1 h-3 w-3" />
            </span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">APY</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{vaultData.apy}%</div>
          <p className="text-xs text-muted-foreground">Based on 30-day performance</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{vaultData.totalShares.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">Exchange Rate: ${vaultData.exchangeRate}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Your Shares</CardTitle>
          <BarChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{userShares.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            Value: ${(userShares * vaultData.exchangeRate).toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

