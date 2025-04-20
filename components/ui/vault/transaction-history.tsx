// "use client"

// import { useState } from "react"
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
// import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
// import { useVault } from "@/context/vault-context"
// import { ArrowDownUp, ArrowDown, ArrowUp } from "lucide-react"

// export function TransactionHistory() {
//   const [filter, setFilter] = useState("all")
//   const { transactions } = useVault()

//   const filteredTransactions = transactions.filter((tx) => {
//     if (filter === "all") return true
//     return tx.type === filter
//   })

//   return (
//     <Card>
//       <CardHeader>
//         <div className="flex items-center justify-between">
//           <div>
//             <CardTitle>Transaction History</CardTitle>
//             <CardDescription>Your recent vault activity</CardDescription>
//           </div>
//           <Tabs value={filter} onValueChange={setFilter} className="w-[400px]">
//             <TabsList className="grid w-full grid-cols-3">
//               <TabsTrigger value="all">All</TabsTrigger>
//               <TabsTrigger value="deposit">Deposits</TabsTrigger>
//               <TabsTrigger value="withdraw">Withdrawals</TabsTrigger>
//             </TabsList>
//           </Tabs>
//         </div>
//       </CardHeader>
//       <CardContent>
//         <div className="rounded-md border">
//           <div className="grid grid-cols-5 bg-muted p-3 text-sm font-medium">
//             <div>Type</div>
//             <div>Amount</div>
//             <div>Shares</div>
//             <div>Date</div>
//             <div>Status</div>
//           </div>
//           <div className="divide-y">
//             {filteredTransactions.length > 0 ? (
//               filteredTransactions.map((tx, index) => (
//                 <div key={index} className="grid grid-cols-5 p-3 text-sm">
//                   <div className="flex items-center">
//                     {tx.type === "deposit" ? (
//                       <ArrowDown className="mr-2 h-4 w-4 text-green-500" />
//                     ) : (
//                       <ArrowUp className="mr-2 h-4 w-4 text-red-500" />
//                     )}
//                     {tx.type === "deposit" ? "Deposit" : "Withdraw"}
//                   </div>
//                   <div>${tx.amount.toLocaleString()}</div>
//                   <div>{tx.shares.toLocaleString()}</div>
//                   <div>{new Date(tx.timestamp).toLocaleDateString()}</div>
//                   <div>
//                     <span
//                       className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
//                         tx.status === "completed"
//                           ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
//                           : tx.status === "pending"
//                             ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
//                             : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
//                       }`}
//                     >
//                       {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
//                     </span>
//                   </div>
//                 </div>
//               ))
//             ) : (
//               <div className="flex flex-col items-center justify-center py-8 text-center">
//                 <ArrowDownUp className="h-8 w-8 text-muted-foreground mb-2" />
//                 <h3 className="text-lg font-medium">No transactions found</h3>
//                 <p className="text-sm text-muted-foreground">
//                   {filter === "all"
//                     ? "You haven't made any transactions yet."
//                     : `You haven't made any ${filter} transactions yet.`}
//                 </p>
//               </div>
//             )}
//           </div>
//         </div>
//       </CardContent>
//     </Card>
//   )
// }

"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useVault } from "@/context/vault-context"
import { ArrowDownUp, ArrowDown, ArrowUp, ExternalLink, RefreshCw, Clock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"

export function TransactionHistory() {
  const [filter, setFilter] = useState("all")
  const { transactions, refreshVaultData, isLoading } = useVault()
  const [visibleCount, setVisibleCount] = useState(5)

  const filteredTransactions = transactions.filter((tx) => {
    if (filter === "all") return true
    return tx.type === filter
  })

  // Summary statistics
  const depositSum = transactions
    .filter(tx => tx.type === "deposit" && tx.status === "completed")
    .reduce((sum, tx) => sum + tx.amount, 0)
  
  const withdrawSum = transactions
    .filter(tx => tx.type === "withdraw" && tx.status === "completed")
    .reduce((sum, tx) => sum + tx.amount, 0)
  
  const handleShowMore = () => {
    setVisibleCount(prev => prev + 5)
  }
  
  const handleRefresh = () => {
    refreshVaultData()
  }
  
  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp)
    return new Intl.DateTimeFormat('en-US', { 
      dateStyle: 'medium', 
      timeStyle: 'short' 
    }).format(date)
  }
  
  const formatTimeAgo = (timestamp) => {
    const secondsAgo = Math.floor((Date.now() - timestamp) / 1000)
    if (secondsAgo < 60) return `${secondsAgo}s ago`
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`
    if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`
    if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`
    return formatDateTime(timestamp).split(',')[0] // Just the date part
  }
  
  const getEtherscanLink = (txHash) => {
    // Update with your network's etherscan URL
    const baseUrl = process.env.NEXT_PUBLIC_NETWORK_NAME === "mainnet" 
      ? "https://etherscan.io/tx/"
      : "https://sepolia.etherscan.io/tx/";
    return baseUrl + txHash;
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>Your recent vault activity</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex text-sm">
              <div className="mr-4">
                <span className="text-muted-foreground">Total Deposited:</span>{' '}
                <span className="font-medium">${depositSum.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Withdrawn:</span>{' '}
                <span className="font-medium">${withdrawSum.toLocaleString()}</span>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Tabs value={filter} onValueChange={setFilter} className="w-[300px]">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="deposit">Deposits</TabsTrigger>
                <TabsTrigger value="withdraw">Withdrawals</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && transactions.length === 0 ? (
          // Loading skeleton state
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="grid grid-cols-5 gap-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border">
            <div className="grid grid-cols-5 bg-muted p-3 text-sm font-medium">
              <div>Type</div>
              <div>Amount</div>
              <div>Shares</div>
              <div>Date</div>
              <div>Status</div>
            </div>
            <div className="divide-y">
              {filteredTransactions.length > 0 ? (
                <>
                  {filteredTransactions.slice(0, visibleCount).map((tx, index) => (
                    <div key={index} className="grid grid-cols-5 p-3 text-sm">
                      <div className="flex items-center">
                        {tx.type === "deposit" ? (
                          <ArrowDown className="mr-2 h-4 w-4 text-green-500" />
                        ) : (
                          <ArrowUp className="mr-2 h-4 w-4 text-red-500" />
                        )}
                        {tx.type === "deposit" ? "Deposit" : "Withdraw"}
                      </div>
                      <div>${tx.amount.toLocaleString()}</div>
                      <div>{tx.shares.toLocaleString()}</div>
                      <div className="flex items-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center">
                              <span>{formatTimeAgo(tx.timestamp)}</span>
                              <Clock className="ml-1 h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{formatDateTime(tx.timestamp)}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex items-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            tx.status === "completed"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                              : tx.status === "pending"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                          }`}
                        >
                          {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                        </span>
                        
                        {tx.txHash && (
                          <a 
                            href={getEtherscanLink(tx.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-500 hover:text-blue-700"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {filteredTransactions.length > visibleCount && (
                    <div className="flex justify-center p-3">
                      <Button variant="outline" onClick={handleShowMore}>
                        Show More
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
  <div className="bg-muted/30 p-4 rounded-full mb-4">
    <ArrowDownUp className="h-10 w-10 text-muted-foreground" />
  </div>
  <h3 className="text-lg font-medium">No transactions found</h3>
  <p className="text-sm text-muted-foreground max-w-[300px] mt-2 mb-6">
    {filter === "all"
      ? "Start your investment journey by making your first deposit to the Vaultopia vault."
      : filter === "deposit"
        ? "You haven't made any deposits yet. Start earning by depositing USDC into the vault."
        : "You haven't made any withdrawals yet. Your funds will appear here when you withdraw."}
  </p>
  {filter === "all" && (
  <Button 
    onClick={() => {
      // Force a hash change by first clearing it if it's already "deposit"
      if (window.location.hash === "#deposit") {
        window.location.hash = "";
        
        // Small delay before setting it back to deposit
        setTimeout(() => {
          window.location.hash = "deposit";
        }, 10);
      } else {
        // Set it directly if it's not already deposit
        window.location.hash = "deposit";
      }
      
      // As backup, try clicking the tab directly
      setTimeout(() => {
        const depositTrigger = document.querySelector('[role="tab"][value="deposit"]');
        if (depositTrigger instanceof HTMLElement) {
          depositTrigger.click();
        }
      }, 100);
    }}
    className="gap-2"
  >
    <ArrowDown className="h-4 w-4" /> Get Started with a Deposit
  </Button>
)}

{filter === "deposit" && (
  <Button 
    onClick={() => {
      // Force a hash change by first clearing it if it's already "deposit"
      if (window.location.hash === "#deposit") {
        window.location.hash = "";
        
        // Small delay before setting it back to deposit
        setTimeout(() => {
          window.location.hash = "deposit";
        }, 10);
      } else {
        // Set it directly if it's not already deposit
        window.location.hash = "deposit";
      }
      // As backup, try clicking the tab directly
      setTimeout(() => {
        const depositTrigger = document.querySelector('[role="tab"][value="deposit"]');
        if (depositTrigger instanceof HTMLElement) {
          depositTrigger.click();
        }
      }, 100);
    }}
    className="gap-2"
  >
    <ArrowDown className="h-4 w-4" /> Make Your First Deposit
  </Button>
)}
</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}