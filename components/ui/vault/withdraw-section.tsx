"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useVault } from "@/context/vault-context"
import { ArrowRight, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function WithdrawSection() {
  const [shares, setShares] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { withdraw, vaultData, userShares } = useVault()

  const handleWithdraw = async () => {
    if (!shares || Number.parseFloat(shares) <= 0) return

    setIsLoading(true)
    try {
      await withdraw(Number.parseFloat(shares))
      setShares("")
    } catch (error) {
      console.error("Withdrawal failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const estimatedAmount = shares ? Number.parseFloat(shares) * vaultData.exchangeRate : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw & Redeem</CardTitle>
        <CardDescription>Burn shares to withdraw your funds</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="withdraw-shares"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Shares to Redeem
              </label>
              <span className="text-xs text-muted-foreground">Available: {userShares.toLocaleString()} Shares</span>
            </div>
            <div className="flex space-x-2">
              <Input
                id="withdraw-shares"
                type="number"
                placeholder="0.0"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={() => setShares(userShares.toString())}>
                Max
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center">
                <span>Estimated Return</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 ml-1 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Amount you will receive for burning shares</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <span className="font-medium">${estimatedAmount.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span>Exchange Rate</span>
              <span className="font-medium">1 Share = ${vaultData.exchangeRate}</span>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleWithdraw}
          disabled={isLoading || !shares || Number.parseFloat(shares) <= 0 || Number.parseFloat(shares) > userShares}
        >
          {isLoading ? "Processing..." : "Withdraw"}
          {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </CardFooter>
    </Card>
  )
}

