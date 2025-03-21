import { ethers } from 'ethers';
import 'dotenv/config';

const ALCHEMY_URL = process.env.ALCHEMY_URL || 'YOUR_ALCHEMY_URL';
const HOLESKY_CHAIN_ID = '0x4268'; // 17000 in hex for Holesky

// Initialize provider
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

// Initialize wallet with private key
// IMPORTANT: Store this securely, preferably in environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY || 'YOUR_PRIVATE_KEY';
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

const Web3Provider = {
  request: async ({ method, params }: { method: string; params: any[] }) => {
    try {
      switch (method) {
        case 'eth_accounts':
          return [await signer.getAddress()];
          
        case 'eth_chainId':
          return HOLESKY_CHAIN_ID;
          
        case 'eth_sendTransaction':
          const tx = await signer.sendTransaction(params[0]);
          await tx.wait(); // Wait for confirmation
          return tx.hash;
          
        case 'eth_sign':
          return await signer.signMessage(ethers.getBytes(params[1]));
          
        case 'eth_estimateGas':
          return await provider.estimateGas(params[0]);
          
        case 'eth_getBalance':
          return await provider.getBalance(params[0]);
          
        default:
          return await provider.send(method, params);
      }
    } catch (error) {
      console.error(`Error in Web3Provider for method ${method}:`, error);
      throw error;
    }
  }
};

export default Web3Provider;