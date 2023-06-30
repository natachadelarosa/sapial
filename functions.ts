export const functions = [
  {
    name: "create_account",
    description: "Create an ethereum account for the user.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "send_transaction",
    description:
      "Sends an ethereum transaction to be executed in the blockchain for the user.",
    parameters: {
      type: "object",
      properties: {
        privateKey: {
          type: "string",
          description:
            "An privateKey that will be used to sign the transaction, e.g. 0xc2c6438247f404e082f15c0357a327159132673b93e45af3bc0e9f59ef32ff96",
        },
        to: {
          type: "string",
          description:
            "An ethereum address to send the transaction to, e.g. 0x92fE27Ed35250D2F9f1c4dE8A369EB9326284508",
        },
      },
      required: ["privateKey", "to"],
    },
  },
];
