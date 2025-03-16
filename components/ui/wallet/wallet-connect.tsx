"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWallet } from "@/context/wallet-context"
import { Copy, LogOut, Wallet } from "lucide-react"
import { toast } from "sonner"

export function WalletConnect() {
  const { isConnected, address, balance, connect, disconnect } = useWallet()

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      toast.info("Address copied", {
        description: "Wallet address copied to clipboard",
      })
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  if (!isConnected) {
    return (
      <Button onClick={connect}>
        <Wallet className="mr-2 h-4 w-4" />
        Connect Wallet
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Wallet className="mr-2 h-4 w-4" />
          {formatAddress(address)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>My Wallet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="flex justify-between">
          <span>Address:</span>
          <span className="font-mono">{formatAddress(address)}</span>
          <Button variant="ghost" size="icon" className="h-4 w-4 ml-2" onClick={copyAddress}>
            <Copy className="h-3 w-3" />
          </Button>
        </DropdownMenuItem>
        <DropdownMenuItem className="flex justify-between">
          <span>Balance:</span>
          <span>{balance} ETH</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={disconnect}>
          <LogOut className="mr-2 h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

