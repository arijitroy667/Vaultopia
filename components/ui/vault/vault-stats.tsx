// "use client"

// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { useVault } from "@/context/vault-context"
// import { ArrowUpRight, TrendingUp, Wallet, Users, BarChart } from "lucide-react"

// export function VaultStats() {
//   const { vaultData, userShares } = useVault()

//   return (
//     <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
//           <Wallet className="h-4 w-4 text-muted-foreground" />
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">${vaultData.tvl.toLocaleString()}</div>
//           <p className="text-xs text-muted-foreground">
//             <span className="text-green-500 flex items-center">
//               +{vaultData.tvlChange}%
//               <ArrowUpRight className="ml-1 h-3 w-3" />
//             </span>
//           </p>
//         </CardContent>
//       </Card>
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">APY</CardTitle>
//           <TrendingUp className="h-4 w-4 text-muted-foreground" />
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{vaultData.apy}%</div>
//           <p className="text-xs text-muted-foreground">Based on 30-day performance</p>
//         </CardContent>
//       </Card>
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
//           <Users className="h-4 w-4 text-muted-foreground" />
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{vaultData.totalShares.toLocaleString()}</div>
//           <p className="text-xs text-muted-foreground">Exchange Rate: ${vaultData.exchangeRate}</p>
//         </CardContent>
//       </Card>
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Your Shares</CardTitle>
//           <BarChart className="h-4 w-4 text-muted-foreground" />
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{userShares.toLocaleString()}</div>
//           <p className="text-xs text-muted-foreground">
//             Value: ${(userShares * vaultData.exchangeRate).toLocaleString()}
//           </p>
//         </CardContent>
//       </Card>
//     </div>
//   )
// }

"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useVault } from "@/context/vault-context"
import { ArrowUpRight, TrendingUp, Wallet, Users, BarChart } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function VaultStats() {
  const { vaultData, userShares, isLoading,fetchLidoAPY } = useVault()
  const [localLoading, setLocalLoading] = useState(false)

  const refreshAPY = async () => {
    try {
      setLocalLoading(true)
      await fetchLidoAPY()
      toast.success("APY data refreshed from Lido")
    } catch (error) {
      toast.error("Failed to refresh APY data")
    } finally {
      setLocalLoading(false)
    }
  }
  
  // Format numbers with 2 decimal places
  const formatCurrency = (value) => {
    if (value === undefined || value === null || isNaN(value)) return "0.00";
    return parseFloat(value.toFixed(2)).toLocaleString()
  }
  
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* TVL Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">${formatCurrency(vaultData?.tvl || 0)}</div>
              <p className="text-xs text-muted-foreground">
                <span className={`flex items-center ${(vaultData?.tvlChange || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {(vaultData?.tvlChange || 0) >= 0 ? '+' : ''}{formatCurrency(vaultData?.tvlChange || 0)}%
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
      
      {/* Original APY Card (Restored) */}
      <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
  <CardTitle className="text-sm font-medium">APY</CardTitle>
  
  <div className="flex items-center">
    <button 
      onClick={refreshAPY} 
      className="mr-2 opacity-70 hover:opacity-100 transition-opacity"
      disabled={localLoading}
    >
      <RefreshCw className={`h-3 w-3 text-muted-foreground ${localLoading ? 'animate-spin' : ''}`} />
    </button>
    <TrendingUp className="h-4 w-4 text-muted-foreground" />
  </div>
</CardHeader>
  <CardContent>
    {isLoading ? (
      <Skeleton className="h-8 w-24" />
    ) : (
      <>
        <div className="text-2xl font-bold">
          {formatCurrency(vaultData?.apy || 0)}%
          <span className="ml-2 text-xs text-cyan-500 font-normal">
            (Lido + 2%)
          </span>
        </div>
        <div className="flex items-center text-xs text-muted-foreground">
          <img 
            src="/lido-logo.png" 
            alt="Lido" 
            className="h-4 w-3 mr-1" 
            onError={(e) => e.currentTarget.style.display = 'none'} 
          />
          Based on last 7-day moving average
        </div>
      </>
    )}
  </CardContent>
</Card>
      
      {/* Total Shares Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">{formatCurrency(vaultData.totalShares)}</div>
              <p className="text-xs text-muted-foreground">
                Exchange Rate: ${formatCurrency(vaultData.exchangeRate)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      
      {/* Your Shares Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Your Shares</CardTitle>
          <BarChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <>
              <div className="text-2xl font-bold">{formatCurrency(userShares)}</div>
              <p className="text-xs text-muted-foreground">
                Value: ${formatCurrency(userShares * vaultData.exchangeRate)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}