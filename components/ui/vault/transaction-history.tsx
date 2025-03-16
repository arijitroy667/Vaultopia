"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useVault } from "@/context/vault-context"
import { ArrowDownUp, ArrowDown, ArrowUp } from "lucide-react"

export function TransactionHistory() {
  const [filter, setFilter] = useState("all")
  const { transactions } = useVault()

  const filteredTransactions = transactions.filter((tx) => {
    if (filter === "all") return true
    return tx.type === filter
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>Your recent vault activity</CardDescription>
          </div>
          <Tabs value={filter} onValueChange={setFilter} className="w-[400px]">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="deposit">Deposits</TabsTrigger>
              <TabsTrigger value="withdraw">Withdrawals</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
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
              filteredTransactions.map((tx, index) => (
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
                  <div>{new Date(tx.timestamp).toLocaleDateString()}</div>
                  <div>
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
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ArrowDownUp className="h-8 w-8 text-muted-foreground mb-2" />
                <h3 className="text-lg font-medium">No transactions found</h3>
                <p className="text-sm text-muted-foreground">
                  {filter === "all"
                    ? "You haven't made any transactions yet."
                    : `You haven't made any ${filter} transactions yet.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

