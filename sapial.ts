import { IConfig } from "./interfaces.ts";
import * as proc from "https://deno.land/x/proc@0.20.28/mod3.ts";
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { guidelines, role } from "./runtime/prompts/prompts.ts";
// import { estimateTokens } from "./runtime/utils/utils.ts";
import { ethers } from "./deps.ts";
const { providers, Wallet, utils } = ethers;


export class Sapial {
    public readonly name: string;
    public readonly primaryModel: string;
    public readonly secondaryModel: string;
    private memory: boolean;
    private summarizeChat = false;
    private chatSummary = ``;
    private bufferChat = false;
    private chatBuffer: string[] = [];
    private readonly contextSize = 16_384;
    private readonly conversatationSummarySize = 4_096;
    private readonly messageBufferSize = 4_096;
    private store: Deno.Kv;
    private provider = new providers.InfuraProvider(
        "sepolia",
        "95d1498a021540ffb54ff99b1a7db857"
      );

    constructor(config: IConfig, store: Deno.Kv ) {
        this.name = config.name;
        this.primaryModel = config.primaryModel;
        this.secondaryModel = config.secondaryModel;
        this.memory = config.memory;
        this.store = store; 
                
        if (config.memory) {
            this.summarizeChat = true;
            this.bufferChat = true;
        }

        // setup the proxy server
        const handler = async (request: Request) => {
            const humanMessage = await request.text();
            console.log(`Human message: ${humanMessage}`);
            const humanMessageWithContext = this.injectContext(humanMessage);
            console.log(`Human message with context: ${humanMessageWithContext}`);
            const response = await this.chatLLM(humanMessage);
            console.log("🚀 ~ file: sapial.ts:47 ~ Sapial ~ handler ~ response:", response)

            return new Response(response);
            // const streamingResponse = await this.streamLLM(humanMessageWithContext);
            // const { readable, writable } = new TransformStream<Uint8Array>;
            // const [responseReadable, localReadable] = readable.tee()
            // response.body!.pipeTo(writable);
            // if (this.memory) {
            //     this.streamToString(localReadable).then( async (AIMessage) => {
            //         console.log(`AI response: ${AIMessage}`)
            //         await this.addMessagePairToBuffer(humanMessage, AIMessage);
            //         this.summarizeChatHistory()
            //     });
            // }
            // return new Response(responseReadable);
        };

        serve(handler, { port: 4242 });
    }

    // create a new root sapial agent from a new config object
    public static async init(config: IConfig) {

        // start the uvicron API server for python services
        proc.run("bash", "run.sh");    
        console.log("Started API service");

        const store = await Deno.openKv();

        // create the sapial agent
        const sapial = new Sapial(config, store);
        return sapial;
    }

    async streamToString(stream: ReadableStream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder("utf-8");
        let result = "";
      
        while (true) {
          const { done, value } = await reader.read();
      
          if (done) {
            return result;
          }
      
          result += decoder.decode(value);
        }
    }

    // adds a new message exchange to the chat buffer and logs
    async addMessagePairToBuffer(humanMessage: string, AIMessage: string) {

        const messagePair = `
            --human-message--
            ${humanMessage}
            --human-message--

            --ai-message--
            ${AIMessage}
            --ai-message--
            `;

        console.log(`Added the follow message to the chat buffer: ${messagePair}`);

        this.chatBuffer.push(messagePair.toString());
        const timestamp = Date.now();
        await this.store.set(['logs', timestamp], messagePair);
        return messagePair
    }

    // updates the chat summary with buffered messages
    summarizeChatHistory() {

        const summarizerPrompt = `
            You are a helpful and insightful AI text summarizer with an IQ of 125.
            You are able to summarize long conversations betweens humans and AI assistants.
            Your goal is to summarize our entire conversation in a way that is both accurate and concise.
            This summary will become the long-term memory of an AI assistant.

            ${this.getChatSummary()}
            ${this.getRecentMessages()}

            Please extend the current summary based on our most recent messages.
            Make sure to retain a summary of our full conversation history.
            Ensure the summary is smaller than ${this.conversatationSummarySize} tokens
            `;

        console.log(`Summarizer prompt: ${summarizerPrompt}`);

        const chatBufferSize = this.chatBuffer.length;
        this.chatLLM(summarizerPrompt).then(async (summary) => {
            console.log(`Chat Summary: ${summary}`)
            this.chatSummary = summary;
            await this.store.set(['summary'], summary);
            this.chatBuffer.splice(0, chatBufferSize);
        });
    }

    // if summarizing, return the current summary
    getChatSummary(): string {

        const summary = `
            Below is the current summary of the chat history with your human:
            --summary--
            ${this.chatSummary? this.chatSummary : `No history to summarize yet.`}
            --summary--
            `;
        return this.summarizeChat ? summary : ``;
    }

    // if buffering, return the most recent (unsummarized) messages 
    getRecentMessages(): string {

        const recentMessages = `
            Here are the most recent messages exchanged with your human:
            --messages--
            ${this.chatBuffer.join('\n')}
            --messages--
            `;

        return this.bufferChat ? recentMessages : ``;
    }

    // add arbitrary context to a prompt (i.e. a conversation summary) before sending to a model
    injectContext(prompt: string) {
        const message = `
            ${role}
            ${this.getChatSummary()}
            ${this.getRecentMessages()}
            ${guidelines}
            ${prompt}
        `
        return message;
    }

    // call the model API service and stream the response
    async streamLLM(prompt: string) {
        const model = this.primaryModel;
        const endpoint = `http://localhost:8000/stream/${model}/${prompt}`
        const response = await fetch(endpoint);
        return response
    }

    // call the model API service, and return the full response
    async chatLLM(prompt: string) {
        const model = this.secondaryModel;
        const endpoint = `http://localhost:8000/chat/${model}/${prompt}`
        const response = await fetch(endpoint);    
        const json = await response.json();
    
        if (json.message?.additional_kwargs?.function_call) {
            const functionCall = json.message.additional_kwargs.function_call;

            if (functionCall.name === 'create_account') {
                const createdAccount = await this.createAccount();

                const messages = [
                    {"role": "user", "content": prompt},
                    {
                        "role": "function",
                        "name": functionCall.name,
                        "content": JSON.stringify(createdAccount),
                    },
                ];
                console.log("🚀 ~ file: sapial.ts:212 ~ Sapial ~ chatLLM ~ messages:", messages)
                const secondResponse =  await this.fetchChatCompletion(messages);
                console.log("🚀 ~ file: sapial.ts:213 ~ Sapial ~ chatLLM ~ response:", secondResponse)
                
                const secondJson = await secondResponse.json();
                console.log("🚀 ~ file: sapial.ts:217 ~ Sapial ~ chatLLM ~ secondJson:", secondJson)
                const content = secondJson.choices[0].message.content;
                return content;
            }
        }

        const content = json.message.content;
        return content;
    }

    async createAccount() {
        const wallet = ethers.Wallet.createRandom();
    
        const privateKey = wallet.privateKey;
        const publicKey = wallet.publicKey;
        const address = wallet.address;

        console.log("Private Key:", privateKey);
        console.log("Public Key:", publicKey);
        console.log("Address:", address);

        return {
            "privateKey": privateKey,
            "publicKey": publicKey,
            "address": address,
        }
    }
    
    async makeTransaction(privateKey: string, to: string) {
        // Create a wallet instance using the private key
        const wallet = new Wallet(privateKey, this.provider);
    
        // Example: Send a transaction
        const recipientAddress = to;
        const amountToSend = utils.parseEther("0.1");
    
        const transaction = await wallet.sendTransaction({
        to: recipientAddress,
        value: amountToSend,
    });

        console.log("Transaction sent:", transaction.hash);

        return transaction;
    }

    async fetchChatCompletion(messages: any): Promise<Response> {
        const apiKey = Deno.env.get("OPENAI_API_KEY");
        const url = "https://api.openai.com/v1/chat/completions";

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        };

        const body = JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: messages,
        });

        const response = await fetch(url, {
            method: "POST",
            headers,
            body,
        });
    
        return response
    }

}