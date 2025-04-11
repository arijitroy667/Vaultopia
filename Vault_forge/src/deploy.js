// deploy.js
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
  
    // Deploy implementation contract first
    const YieldBullImplementation = await ethers.getContractFactory("Yield_Bull_Implementation");
    const implementation = await YieldBullImplementation.deploy();
    await implementation.deployed();
    console.log("Implementation deployed to:", implementation.address);
  
    // Deploy proxy contract
    const ProxyVault = await ethers.getContractFactory("ProxyVault");
    const proxy = await ProxyVault.deploy(implementation.address);
    await proxy.deployed();
    console.log("Proxy deployed to:", proxy.address);
  
    // Initialize the implementation through the proxy
    const vault = await ethers.getContractAt("Yield_Bull_Implementation", proxy.address);
    
    // USDC address on Holesky
    const usdcAddress = "0x06901fD3D877db8fC8788242F37c1A15f05CEfF8";
    
    // Other addresses from Holesky testnet
    const lidoWithdrawalAddress = "0xc7cc160b58F8Bb0baC94b80847E2CF2800565C50";
    const wstETHAddress = "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D";
    const receiverAddress = "0x5b04981Ba22280359EC4Ca3d8B5EdAC55984De47";
    const swapContractAddress = "0xd2151d43C7D3CC15dAd1B5C0deaB50A4b30eb154";
  
    await vault.initialize(
      usdcAddress,
      lidoWithdrawalAddress,
      wstETHAddress,
      receiverAddress,
      swapContractAddress
    );
    console.log("Vault initialized");
  
    // Deploy VaultLens for read-only functions if needed
    const VaultLens = await ethers.getContractFactory("VaultLens");
    const lens = await VaultLens.deploy(proxy.address);
    await lens.deployed();
    console.log("VaultLens deployed to:", lens.address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });