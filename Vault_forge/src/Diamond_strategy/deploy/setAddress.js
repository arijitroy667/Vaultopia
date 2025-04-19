// Diamond_setup.js - Set all required contract addresses on Diamond
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to read ABI from compiled artifacts
function getAbi(contractName) {
  const artifactPath = path.join(
    __dirname, 
    "..",          
    "..",          
    "..",          
    "out",         
    `${contractName}.sol`, 
    `${contractName}.json`
  );
  
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
}

async function setupDiamond() {
  console.log("Starting Diamond address setup...");
  
  // Provider and wallet setup
  const provider = new ethers.JsonRpcProvider('https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs');
  const privateKey = "";
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is not set");
  }
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Address configurations for Holesky testnet
  const DIAMOND_ADDRESS = "0x6C510C4eca8D7Bb03D7BA220fAF3f4cC332Aa6a0"; // Replace with your deployed Diamond address
  const ADDRESSES = {
    // Core contract addresses
    lidoWithdrawal: "0xF0179dEC45a37423EAD4FaD5fCb136197872EAd9", // Lido withdrawal address
    wstETH: "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D", // wstETH token
    receiver: "0x5b04981Ba22280359EC4Ca3d8B5EdAC55984De47", // Receiver contract
    swapContract: "0x9C13eEa3Eae9aa791f00BB798ff042F3c2Bb26DB", // Swap contract
    feeCollector: "0xaBb39905aE12EfC057a9381A63e9A372BCCc53C1", // Your wallet as fee collector (replace as needed)
    
    // Other useful addresses
    weth: "0x94373a4919B3240D86eA41593D5eBa789FEF3848", // Holesky WETH
    usdc: "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8"  // Holesky USDC
  };
  
  // Create an instance of the AdminFacet
  const adminFacetAbi = getAbi("AdminFacet");
  const adminFacet = new ethers.Contract(DIAMOND_ADDRESS, adminFacetAbi, wallet);
  
  console.log("Setting up Diamond contract addresses...");
  
  try {
    // Set all addresses using the AdminFacet functions
    console.log("Setting Lido withdrawal address...");
    let tx = await adminFacet.setLidoWithdrawalAddress(ADDRESSES.lidoWithdrawal);
    await tx.wait();
    console.log(`✅ Lido withdrawal address set to ${ADDRESSES.lidoWithdrawal}`);
    
    console.log("Setting wstETH address...");
    tx = await adminFacet.setWstETHAddress(ADDRESSES.wstETH);
    await tx.wait();
    console.log(`✅ wstETH address set to ${ADDRESSES.wstETH}`);
    
    console.log("Setting receiver contract address...");
    tx = await adminFacet.setReceiverContract(ADDRESSES.receiver);
    await tx.wait();
    console.log(`✅ Receiver contract set to ${ADDRESSES.receiver}`);
    
    console.log("Setting swap contract address...");
    tx = await adminFacet.setSwapContract(ADDRESSES.swapContract);
    await tx.wait();
    console.log(`✅ Swap contract set to ${ADDRESSES.swapContract}`);
    
    console.log("Setting fee collector address...");
    tx = await adminFacet.setFeeCollector(ADDRESSES.feeCollector);
    await tx.wait();
    console.log(`✅ Fee collector set to ${ADDRESSES.feeCollector}`);
    
    console.log("\n🎉 All addresses successfully configured on Diamond contract!");
    
    // Verify settings
    const diamondLoupeAbi = getAbi("DiamondLoupeFacet");
    const loupe = new ethers.Contract(DIAMOND_ADDRESS, diamondLoupeAbi, wallet);
    
    console.log("\nVerifying facets:");
    const facets = await loupe.facets();
    for (const facet of facets) {
      console.log(`- Facet at ${facet.facetAddress} with ${facet.functionSelectors.length} functions`);
    }
    
  } catch (error) {
    console.error("Error setting up Diamond:", error);
    throw error;
  }
}

// Run setup
setupDiamond()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });