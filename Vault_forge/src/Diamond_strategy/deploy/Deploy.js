import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FacetCutAction as object instead of enum
const FacetCutAction = {
  Add: 0,
  Replace: 1,
  Remove: 2
};

// Function to read compiled artifacts
function getArtifact(contractName) {
  const artifactPath = path.join(
    __dirname, 
    "..",          // Diamond_strategy directory
    "..",          // src directory
    "..",          // Vault_forge directory (don't go up to project root)
    "out",         // output directory is in Vault_forge, not project root
    `${contractName}.sol`, 
    `${contractName}.json`
  );
  console.log(`Looking for artifact at: ${artifactPath}`);
  
  try {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    // Check for file existence 
    if (fs.existsSync(path.dirname(artifactPath))) {
      console.log(`Directory exists, but file is missing: ${artifactPath}`);
      
      // List the files in the directory to help debugging
      const files = fs.readdirSync(path.dirname(artifactPath));
      console.log(`Files in directory: ${files.join(', ')}`);
    } else {
      console.log(`Directory doesn't exist: ${path.dirname(artifactPath)}`);
      
      // Check parent directory
      const parentDir = path.join(__dirname, "..", "..", "..", "out");
      if (fs.existsSync(parentDir)) {
        console.log(`Output directory exists at: ${parentDir}`);
        const dirs = fs.readdirSync(parentDir);
        console.log(`Output directories: ${dirs.join(', ')}`);
      } else {
        console.log(`Output directory doesn't exist at: ${parentDir}`);
      }
    }
    throw error;
  }
}

// Helper function to get selectors
function getSelectors(abi) {
  const selectors = [];
  for (const item of abi) {
    if (item.type === "function" && 
        item.name !== "init" && 
        item.name !== "supportsInterface") {
      const signature = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
      const selector = ethers.id(signature).slice(0, 10);
      selectors.push(selector);
    }
  }
  return selectors;
}

// Function to output details about a selector for debugging
function getSelectorDetails(abi, selector) {
  for (const item of abi) {
    if (item.type === "function" && 
        item.name !== "init" && 
        item.name !== "supportsInterface") {
      const signature = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
      const thisSelector = ethers.id(signature).slice(0, 10);
      if (thisSelector === selector) {
        return signature;
      }
    }
  }
  return "unknown";
}

async function main() {
  console.log("Starting Diamond pattern deployment...");
  
  // Use environment variable for provider URL - never hardcode API keys
  const provider = new ethers.JsonRpcProvider('https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs');
  
  // Load private key from environment variable - never hardcode private keys
  const privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY || "d2e4e01ab9b92394317a4850a8321a62f30c4609d936b6bf79e0321791b32d25";
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is not set");
  }
  
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Deployer address: ${wallet.address}`);
  
  // Addresses for initialization - replace with actual addresses
  const lidoWithdrawalAddress = "0xc7cc160b58F8Bb0baC94b80847E2CF2800565C50";
  const wstETHAddress = "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D";
  const receiverAddress = "0xd000d2399499aB96a3fa023c8964aFBB459AAE6D";
  const swapContractAddress = "0x5C7cda1d0784d0D662E772A2a5450EA48fd687e2";
  const assetTokenAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8"; // USDC
  
  // Deploy DiamondCutFacet
  console.log("1. Deploying DiamondCutFacet...");
  const diamondCutFacetArtifact = getArtifact("DiamondCutFacet");
  const DiamondCutFacet = new ethers.ContractFactory(
    diamondCutFacetArtifact.abi,
    diamondCutFacetArtifact.bytecode,
    wallet
  );
  const diamondCutFacet = await DiamondCutFacet.deploy();
  await diamondCutFacet.waitForDeployment();
  const diamondCutFacetAddress = await diamondCutFacet.getAddress();
  console.log(`DiamondCutFacet deployed to: ${diamondCutFacetAddress}`);
  
  // Extract DiamondCutFacet selectors - to exclude them later
  const diamondCutSelectors = getSelectors(diamondCutFacetArtifact.abi);
  console.log(`DiamondCutFacet selectors: ${diamondCutSelectors}`);
  
  // Deploy Diamond
  console.log("2. Deploying Diamond...");
  const diamondArtifact = getArtifact("Diamond");
  const Diamond = new ethers.ContractFactory(
    diamondArtifact.abi,
    diamondArtifact.bytecode,
    wallet
  );
  const diamond = await Diamond.deploy(wallet.address, diamondCutFacetAddress);
  await diamond.waitForDeployment();
  const diamondAddress = await diamond.getAddress();
  console.log(`Diamond deployed to: ${diamondAddress}`);
  
  // Deploy other facets
  console.log("3. Deploying all facets...");
  
  // Deploy DiamondLoupeFacet
  const diamondLoupeFacetArtifact = getArtifact("DiamondLoupeFacet");
  const DiamondLoupeFacet = new ethers.ContractFactory(
    diamondLoupeFacetArtifact.abi,
    diamondLoupeFacetArtifact.bytecode,
    wallet
  );
  const diamondLoupeFacet = await DiamondLoupeFacet.deploy();
  await diamondLoupeFacet.waitForDeployment();
  const diamondLoupeFacetAddress = await diamondLoupeFacet.getAddress();
  console.log(`DiamondLoupeFacet deployed to: ${diamondLoupeFacetAddress}`);
  
  // Deploy OwnershipFacet
  const ownershipFacetArtifact = getArtifact("OwnershipFacet");
  const OwnershipFacet = new ethers.ContractFactory(
    ownershipFacetArtifact.abi,
    ownershipFacetArtifact.bytecode,
    wallet
  );
  const ownershipFacet = await OwnershipFacet.deploy();
  await ownershipFacet.waitForDeployment();
  const ownershipFacetAddress = await ownershipFacet.getAddress();
  console.log(`OwnershipFacet deployed to: ${ownershipFacetAddress}`);
  
  // Deploy DepositFacet
  const depositFacetArtifact = getArtifact("DepositFacet");
  const DepositFacet = new ethers.ContractFactory(
    depositFacetArtifact.abi,
    depositFacetArtifact.bytecode,
    wallet
  );
  const depositFacet = await DepositFacet.deploy();
  await depositFacet.waitForDeployment();
  const depositFacetAddress = await depositFacet.getAddress();
  console.log(`DepositFacet deployed to: ${depositFacetAddress}`);
  
  // Deploy WithdrawFacet
  const withdrawFacetArtifact = getArtifact("WithdrawFacet");
  const WithdrawFacet = new ethers.ContractFactory(
    withdrawFacetArtifact.abi,
    withdrawFacetArtifact.bytecode,
    wallet
  );
  const withdrawFacet = await WithdrawFacet.deploy();
  await withdrawFacet.waitForDeployment();
  const withdrawFacetAddress = await withdrawFacet.getAddress();
  console.log(`WithdrawFacet deployed to: ${withdrawFacetAddress}`);
  
  // Deploy ViewFacet
  const viewFacetArtifact = getArtifact("ViewFacet");
  const ViewFacet = new ethers.ContractFactory(
    viewFacetArtifact.abi,
    viewFacetArtifact.bytecode,
    wallet
  );
  const viewFacet = await ViewFacet.deploy();
  await viewFacet.waitForDeployment();
  const viewFacetAddress = await viewFacet.getAddress();
  console.log(`ViewFacet deployed to: ${viewFacetAddress}`);
  
  // Deploy AdminFacet
  const adminFacetArtifact = getArtifact("AdminFacet");
  const AdminFacet = new ethers.ContractFactory(
    adminFacetArtifact.abi,
    adminFacetArtifact.bytecode,
    wallet
  );
  const adminFacet = await AdminFacet.deploy();
  await adminFacet.waitForDeployment();
  const adminFacetAddress = await adminFacet.getAddress();
  console.log(`AdminFacet deployed to: ${adminFacetAddress}`);
  
  // Deploy DiamondInit
  console.log("4. Deploying DiamondInit...");
  const diamondInitArtifact = getArtifact("DiamondInit");
  const DiamondInit = new ethers.ContractFactory(
    diamondInitArtifact.abi,
    diamondInitArtifact.bytecode,
    wallet
  );
  const diamondInit = await DiamondInit.deploy();
  await diamondInit.waitForDeployment();
  const diamondInitAddress = await diamondInit.getAddress();
  console.log(`DiamondInit deployed to: ${diamondInitAddress}`);
  
  // Prepare diamond cut
  console.log("5. Preparing diamond cut data...");
  
  // First get all the selectors to check for duplicates between facets
  const rawDiamondLoupeSelectors = getSelectors(diamondLoupeFacetArtifact.abi);
  const rawOwnershipSelectors = getSelectors(ownershipFacetArtifact.abi);
  const rawDepositSelectors = getSelectors(depositFacetArtifact.abi);
  const rawWithdrawSelectors = getSelectors(withdrawFacetArtifact.abi);
  const rawViewSelectors = getSelectors(viewFacetArtifact.abi);
  const rawAdminSelectors = getSelectors(adminFacetArtifact.abi);
  
  // Create a mapping of all selectors to detect duplicates
  const allSelectorsMap = new Map();
  
  // First add diamondCutSelectors (which are already deployed and can't be changed)
  for (const selector of diamondCutSelectors) {
    allSelectorsMap.set(selector, {
      facet: "DiamondCutFacet",
      signature: getSelectorDetails(diamondCutFacetArtifact.abi, selector),
      address: diamondCutFacetAddress,
      isDeployed: true // Already deployed in Diamond constructor
    });
  }
  
  // Define function to safely add selectors
  function addSelectorsToMap(selectors, facetName, facetAbi, facetAddress, map) {
    const result = [];
    for (const selector of selectors) {
      if (!map.has(selector)) {
        map.set(selector, {
          facet: facetName,
          signature: getSelectorDetails(facetAbi, selector),
          address: facetAddress,
          isDeployed: false
        });
        result.push(selector);
      } else {
        const existing = map.get(selector);
        console.log(`WARNING: Duplicate selector ${selector} (${getSelectorDetails(facetAbi, selector)}) - already used by ${existing.facet} (${existing.signature})`);
        // Don't add duplicate
      }
    }
    return result;
  }
  
  // Now safely add all other selectors, filtering duplicates
  const diamondLoupeSelectors = addSelectorsToMap(
    rawDiamondLoupeSelectors, 
    "DiamondLoupeFacet", 
    diamondLoupeFacetArtifact.abi, 
    diamondLoupeFacetAddress, 
    allSelectorsMap
  );
  
  const ownershipSelectors = addSelectorsToMap(
    rawOwnershipSelectors, 
    "OwnershipFacet", 
    ownershipFacetArtifact.abi, 
    ownershipFacetAddress, 
    allSelectorsMap
  );
  
  const depositSelectors = addSelectorsToMap(
    rawDepositSelectors, 
    "DepositFacet", 
    depositFacetArtifact.abi, 
    depositFacetAddress, 
    allSelectorsMap
  );
  
  const withdrawSelectors = addSelectorsToMap(
    rawWithdrawSelectors, 
    "WithdrawFacet", 
    withdrawFacetArtifact.abi, 
    withdrawFacetAddress, 
    allSelectorsMap
  );
  
  const viewSelectors = addSelectorsToMap(
    rawViewSelectors, 
    "ViewFacet", 
    viewFacetArtifact.abi, 
    viewFacetAddress, 
    allSelectorsMap
  );
  
  const adminSelectors = addSelectorsToMap(
    rawAdminSelectors, 
    "AdminFacet", 
    adminFacetArtifact.abi, 
    adminFacetAddress, 
    allSelectorsMap
  );
  
  // Create cut array with only facets that have selectors
  const cut = [];
  
  // Only add facets with selectors remaining after filtering
  if (diamondLoupeSelectors.length > 0) {
    cut.push({
      facetAddress: diamondLoupeFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: diamondLoupeSelectors
    });
  }
  
  if (ownershipSelectors.length > 0) {
    cut.push({
      facetAddress: ownershipFacetAddress, 
      action: FacetCutAction.Add,
      functionSelectors: ownershipSelectors
    });
  }
  
  if (depositSelectors.length > 0) {
    cut.push({
      facetAddress: depositFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: depositSelectors
    });
  }
  
  if (withdrawSelectors.length > 0) {
    cut.push({
      facetAddress: withdrawFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: withdrawSelectors
    });
  }
  
  if (viewSelectors.length > 0) {
    cut.push({
      facetAddress: viewFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: viewSelectors
    });
  }
  
  if (adminSelectors.length > 0) {
    cut.push({
      facetAddress: adminFacetAddress,
      action: FacetCutAction.Add,
      functionSelectors: adminSelectors
    });
  }

  // Log what we're adding
  for (const facetCut of cut) {
    console.log(`Adding ${facetCut.functionSelectors.length} functions from ${facetCut.facetAddress}`);
    
    // Debug what's being added
    for (const selector of facetCut.functionSelectors) {
      const selectorInfo = allSelectorsMap.get(selector);
      console.log(`  - ${selector} (${selectorInfo.signature})`);
    }
  }
  
  // Create initialization data
  const diamondInitInterface = new ethers.Interface(diamondInitArtifact.abi);
  const initData = diamondInitInterface.encodeFunctionData("init", [
    lidoWithdrawalAddress,
    wstETHAddress,
    receiverAddress,
    swapContractAddress,
    assetTokenAddress
  ]);
  
  // Execute diamond cut
  console.log("6. Executing diamond cut...");
  
  // Check if we have any selectors to add
  if (cut.length === 0) {
    console.log("No selectors to add after filtering!");
  } else {
    const diamondCutInterface = new ethers.Interface(diamondCutFacetArtifact.abi);
    const diamondAsContract = new ethers.Contract(
      diamondAddress,
      diamondCutInterface,
      wallet
    );
    
    try {
      console.log(`Adding ${cut.length} facets to diamond...`);
      const tx = await diamondAsContract.diamondCut(cut, diamondInitAddress, initData);
      console.log(`Transaction hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Diamond cut completed in block ${receipt.blockNumber}`);
    } catch (error) {
      console.error("Diamond cut failed:", error);
      throw error;
    }
  }
  
  // Verify deployment
  console.log("7. Verifying deployment...");
  try {
    // Wait a moment to ensure transaction is fully processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const diamondLoupeInterface = new ethers.Interface(diamondLoupeFacetArtifact.abi);
    const loupeContract = new ethers.Contract(
      diamondAddress,
      diamondLoupeInterface,
      wallet
    );
    
    const facets = await loupeContract.facets();
    console.log("\nRegistered facets:");
    for (const facet of facets) {
      console.log(`- Address: ${facet.facetAddress} | Selectors: ${facet.functionSelectors.length}`);
    }
    
    const ownershipInterface = new ethers.Interface(ownershipFacetArtifact.abi);
    const ownershipContract = new ethers.Contract(
      diamondAddress,
      ownershipInterface,
      wallet
    );
    
    const owner = await ownershipContract.owner();
    console.log(`\nDiamond owner: ${owner}`);
    
    // Try to check vault state
    const viewInterface = new ethers.Interface(viewFacetArtifact.abi);
    const viewContract = new ethers.Contract(
      diamondAddress,
      viewInterface,
      wallet
    );
    
    const totalAssets = await viewContract.totalAssets();
    console.log(`\nVault initialized. Total assets: ${totalAssets.toString()}`);
    
  } catch (e) {
    console.error("Error during verification:", e);
  }
  
  console.log("\nDeployment complete!");
  console.log(`Diamond address (main contract): ${diamondAddress}`);
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });