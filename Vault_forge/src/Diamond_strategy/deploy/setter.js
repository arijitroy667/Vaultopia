import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ethers } from 'ethers';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set up file paths for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Variables
const PRIVATE_KEY = "144b73c3645e2cc6522c3e090e3892afc693133cae399c271af91fde7332d6e4";
const RPC_URL = "https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs";
const DIAMOND_ADDRESS = "0xAE778866f50A1d9289728c99a5a1821DA8844f72";
const SWAP_ADDRESS = "0x9Be14C2846611DAa57594aFc43B0f78ed82b92C2";
const RECEIVER_ADDRESS = "0x5b04981Ba22280359EC4Ca3d8B5EdAC55984De47";

async function main() {
  console.log("Starting Diamond contract configuration...");
  
  // Connect to the network
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Connected to network with address ${wallet.address}`);

  try {
    // Skip deployment and diamond cut - just use existing functions
    console.log("Functions already exist in Diamond, using them directly...");
    
    // Create an interface for the setter functions
    const setterInterface = new ethers.Interface([
      "function setSwapContract(address _swapContract)",
      "function setReceiverContract(address _receiverContract)"
    ]);
    
    // Connect to the Diamond contract
    const diamond = new ethers.Contract(DIAMOND_ADDRESS, setterInterface, wallet);
    
    // Set the swap contract address
    console.log(`Setting swap contract to: ${SWAP_ADDRESS}`);
    const swapTx = await diamond.setSwapContract(SWAP_ADDRESS);
    await swapTx.wait();
    console.log(`✅ Swap contract set successfully!`);
    
    // Set the receiver contract address
    console.log(`Setting receiver contract to: ${RECEIVER_ADDRESS}`);
    const receiverTx = await diamond.setReceiverContract(RECEIVER_ADDRESS);
    await receiverTx.wait();
    console.log(`✅ Receiver contract set successfully!`);
    
    console.log("✨ Setup complete! Your vault's deposit function should now work correctly.");
    
  } catch (error) {
    console.error("❌ Error during configuration:", error);
    
    // Provide more specific error information
    if (error.message && error.message.includes("execution reverted")) {
      if (error.message.includes("Not owner")) {
        console.error("You don't have owner permissions to set these addresses");
      } else {
        console.error("Contract error:", error.reason || error.message);
      }
    }
    
    process.exit(1);
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });