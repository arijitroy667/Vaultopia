"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight, Lock, Shield, TrendingUp } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WalletConnect } from "@/components/ui/wallet/wallet-connect"
import { VaultStats } from "@/components/ui/vault/vault-stats"
import { DepositSection } from "@/components/ui/vault/deposit-section"
import { WithdrawSection } from "@/components/ui/vault/withdraw-section"
import { TransactionHistory } from "@/components/ui/vault/transaction-history"
import { AdminPanel } from "@/components/ui/vault/admin-panel"
import { useWallet } from "@/context/wallet-context"
import { useVault } from "@/context/vault-context"
import { Button } from "@/components/ui/button"

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("dashboard")
  const { isConnected, isAdmin } = useWallet()
  const { vaultData } = useVault()

  return (
    <div className="min-h-screen bg-background">
      <header className="mt-10 ml-8 mr-8">
      <nav className="flex justify-between items-center mb-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-2"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#f9389f] to-cyan-400 flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <span className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500">
              Vaultopia
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Button variant="outline" className="border-cyan-500/50 text-cyan-500 hover:bg-cyan-950/30 border-cyan-500">
              Documentation
            </Button>
          </motion.div>
        </nav>
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
          <div className="min-h-[80vh] -mx-6 -mt-6 bg-gradient-to-b from-black to-slate-900 text-white overflow-hidden relative">
            {/* Animated background */}
            <ParticleBackground />

            {/* Glowing orb */}
            <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />

            {/* Grid lines */}
            <div className="absolute inset-0 z-0 opacity-20">
              <div className="h-full w-full bg-[linear-gradient(to_right,#8884_1px,transparent_1px),linear-gradient(to_bottom,#8884_1px,transparent_1px)] bg-[size:50px_50px]" />
            </div>

            <div className="container mx-auto px-4 py-12 relative z-10">
              <div className="flex flex-col lg:flex-row items-center gap-12 py-12">
                <div className="lg:w-1/2">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7 }}
                  >
                    <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
                      <span className="block">The Future of</span>
                      <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600">
                        Secure DeFi Yield
                      </span>
                    </h1>

                    <TypingText
                      text="Stake USDC. Earn yield. Never compromise on security."
                      className="text-xl text-gray-300 mb-8"
                    />

                    <div className="flex flex-wrap gap-4 mb-12">
                      <FeatureCard
                        icon={<Lock className="w-5 h-5 text-cyan-400" />}
                        title="30-Day Lock"
                        description="Strategic lock period for optimal yield generation"
                      />
                      <FeatureCard
                        icon={<TrendingUp className="w-5 h-5 text-cyan-400" />}
                        title="Premium Yield"
                        description="Competitive returns on your USDC deposits"
                      />
                      <FeatureCard
                        icon={<Shield className="w-5 h-5 text-cyan-400" />}
                        title="60% Liquidity"
                        description="Access to partial funds during lock period"
                      />
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.3 }}
                    className="mb-8"
                  >
                    <div className="p-0.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500">
                      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
                            <span className="text-sm text-gray-400">Live Metrics</span>
                          </div>
                          <span className="text-xs text-gray-500">Updated 2 minutes ago</span>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <MetricCard label="TVL" value="$4.2M" change="+12.5%" />
                          <MetricCard label="APY" value="8.4%" change="+0.3%" />
                          <MetricCard label="Users" value="1,240" change="+64" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.7, delay: 0.2 }}
                  className="lg:w-1/2 flex justify-center"
                >
                  <div className="relative">
                    {/* Animated vault illustration */}
                    <VaultAnimation />

                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/80 backdrop-blur-xl rounded-xl p-8 w-full max-w-md border border-gray-800">
                        <div className="flex flex-col items-center justify-center py-8">
                          <motion.h2
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="text-2xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500"
                          >
                            Connect Your Wallet
                          </motion.h2>
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            className="text-muted-foreground mb-8 text-center max-w-md"
                          >
                            Connect your wallet to interact with the DeFi Vault. Deposit funds, mint shares, and track
                            your investments.
                          </motion.p>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.7 }}
                            className="w-full"
                          >
                            <WalletConnect />
                          </motion.div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// Animated typing text component
function TypingText({ text, className = "" }) {
  const [displayText, setDisplayText] = useState("")
  const index = useRef(0)

  useEffect(() => {
    if (index.current < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText((prev) => prev + text[index.current])
        index.current += 1
      }, 50)

      return () => clearTimeout(timeout)
    }
  }, [displayText, text])

  return (
    <p className={className}>
      {displayText}
      <span className="animate-pulse">|</span>
    </p>
  )
}

// Feature card component
function FeatureCard({ icon, title, description }) {
  return (
    <motion.div
      whileHover={{ scale: 1.05, y: -5 }}
      className="bg-gradient-to-r p-[1px] from-cyan-500/20 to-blue-500/20 rounded-lg"
    >
      <div className="bg-black/60 backdrop-blur-sm p-4 rounded-lg flex items-start gap-3 w-64">
        <div className="mt-1 bg-slate-900 p-2 rounded-md">{icon}</div>
        <div>
          <h3 className="font-medium text-white mb-1">{title}</h3>
          <p className="text-sm text-gray-400">{description}</p>
        </div>
      </div>
    </motion.div>
  )
}

// Metric card component
function MetricCard({ label, value, change }) {
  const isPositive = change.startsWith("+")

  return (
    <div className="bg-slate-900/50 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-white mb-1">{value}</div>
      <div className={`text-xs ${isPositive ? "text-green-400" : "text-red-400"}`}>{change}</div>
    </div>
  )
}

// Animated background with particles
function ParticleBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    let animationFrameId

    // Set canvas dimensions
    const setCanvasDimensions = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    setCanvasDimensions()
    window.addEventListener("resize", setCanvasDimensions)

    // Particle properties
    const particlesArray = []
    const numberOfParticles = 100

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width
        this.y = Math.random() * canvas.height
        this.size = Math.random() * 2 + 0.5
        this.speedX = Math.random() * 0.5 - 0.25
        this.speedY = Math.random() * 0.5 - 0.25
        this.color = `rgba(${Math.floor(Math.random() * 50 + 100)}, ${Math.floor(Math.random() * 50 + 150)}, ${Math.floor(Math.random() * 50 + 200)}, ${Math.random() * 0.5 + 0.1})`
      }

      update() {
        this.x += this.speedX
        this.y += this.speedY

        if (this.x > canvas.width) this.x = 0
        if (this.x < 0) this.x = canvas.width
        if (this.y > canvas.height) this.y = 0
        if (this.y < 0) this.y = canvas.height
      }

      draw() {
        ctx.fillStyle = this.color
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Create particles
    const init = () => {
      for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle())
      }
    }

    init()

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update()
        particlesArray[i].draw()
      }

      animationFrameId = requestAnimationFrame(animate)
    }

    animate()

    // Cleanup
    return () => {
      window.removeEventListener("resize", setCanvasDimensions)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 z-0" />
}

// Animated vault illustration
function VaultAnimation() {
  return (
    <div className="relative w-[400px] h-[400px]">
      {/* Outer ring */}
      <motion.div
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 1, rotate: 360 }}
        transition={{ duration: 120, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] border-2 border-dashed border-cyan-500/30 rounded-full"
      />

      {/* Middle ring */}
      <motion.div
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 1, rotate: -360 }}
        transition={{ duration: 90, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] border-2 border-dashed border-blue-500/40 rounded-full"
      />

      {/* Inner ring */}
      <motion.div
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 1, rotate: 360 }}
        transition={{ duration: 60, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] border-2 border-dashed border-purple-500/50 rounded-full"
      />

      {/* Center vault */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/10"
      >
        <motion.div
          animate={{
            boxShadow: [
              "0 0 20px rgba(6, 182, 212, 0.3)",
              "0 0 40px rgba(6, 182, 212, 0.5)",
              "0 0 20px rgba(6, 182, 212, 0.3)",
            ],
          }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
          className="w-[100px] h-[100px] rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center"
        >
          <Lock className="w-10 h-10 text-white" />
        </motion.div>
      </motion.div>

      {/* Orbiting elements */}
      <motion.div
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 1, rotate: 360 }}
        transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px]"
      >
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center"
          whileHover={{ scale: 1.2 }}
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, rotate: 90 }}
        animate={{ opacity: 1, rotate: 450 }}
        transition={{ duration: 25, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px]"
      >
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center"
          whileHover={{ scale: 1.2 }}
        >
          <TrendingUp className="w-3 h-3 text-white" />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, rotate: 180 }}
        animate={{ opacity: 1, rotate: 540 }}
        transition={{ duration: 30, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px]"
      >
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center"
          whileHover={{ scale: 1.2 }}
        >
          <Shield className="w-3 h-3 text-white" />
        </motion.div>
      </motion.div>
    </div>
  )
}
