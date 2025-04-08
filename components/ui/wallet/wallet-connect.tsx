"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
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
  const [isHovering, setIsHovering] = useState(false)

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
      // <Button onClick={connect}>
      //   <Wallet className="mr-2 h-4 w-4" />
      //   Connect Wallet
      // </Button>
      <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="w-full"
      onHoverStart={() => setIsHovering(true)}
      onHoverEnd={() => setIsHovering(false)}
    >
      <Button onClick={connect} className="w-full h-14 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-lg relative overflow-hidden group">
        {/* Animated background effect */}
        <div className="absolute inset-0 w-full h-full">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.3),transparent_80%)]"></div>

          {isHovering && (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute -inset-1 rounded-lg blur-sm bg-gradient-to-r from-cyan-400 to-blue-500 opacity-70"
              />
              <motion.div
                initial={{ left: "-40%" }}
                animate={{ left: "140%" }}
                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.5 }}
                className="absolute top-0 bottom-0 left-0 w-1/4 -ml-56 bg-gradient-to-r from-transparent via-white to-transparent skew-x-[45deg] transform opacity-40"
              />
            </>
          )}
        </div>

        <span className="relative flex items-center justify-center gap-2 font-medium text-lg">
          <Wallet className="w-5 h-5" />
          Connect Wallet
          {/* Animated dots */}
          <span className="flex gap-1 items-center">
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0 }}
              className="w-1 h-1 bg-white rounded-full"
            />
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.2 }}
              className="w-1 h-1 bg-white rounded-full"
            />
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.4 }}
              className="w-1 h-1 bg-white rounded-full"
            />
          </span>
        </span>
      </Button>
    </motion.div>
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

