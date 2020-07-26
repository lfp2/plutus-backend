const { Router } = require("express");
const fs = require("fs");
const https = require("https");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const routes = new Router();

const httpsAgent = new https.Agent({
  cert: fs.readFileSync("src/certs/client_certificate.crt"),
  key: fs.readFileSync("src/certs/client_private_key.key"),
  ca: fs.readFileSync("src/certs/chain.crt"),
});

const randomID = (identifier) => {
  return identifier + "." + Math.random().toString(36).substr(2, 9);
};

routes.get("/payment/token", async (req, res) => {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("scope", "payments openid");
  try {
    const { amount, identification, name } = req.query;
    const credentialResponse = await axios.post(
      process.env.TOKEN_ENDPOINT,
      params,
      {
        httpsAgent,
        headers: {
          Authorization: `Basic ${process.env.BASIC_TOKEN}`,
        },
      }
    );

    const accessToken = credentialResponse["data"]["access_token"];
    const consentResponse = await axios.post(
      `${process.env.RS_ENDPOINT}/open-banking/v3.1/pisp/domestic-payment-consents`,
      {
        Data: {
          Initiation: {
            InstructionIdentification: randomID("PMT"),
            EndToEndIdentification: randomID("TRX"),
            InstructedAmount: {
              Amount: `${amount}.00`,
              Currency: "BRL",
            },
            CreditorAccount: {
              SchemeName: "BR.CNPJ",
              Identification: identification,
              Name: name,
            },
          },
        },
        Risk: {},
      },
      {
        httpsAgent,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-fapi-financial-id": process.env.PARTICIPANT_ID,
          "x-fapi-customer-ip-address": "10.1.1.10",
          "x-fapi-interaction-id": uuidv4(),
        },
      }
    );
    const { ConsentId: consentId, Status: status } = consentResponse.data[
      "Data"
    ];
    if (status !== "AwaitingAuthorisation")
      return res.status(400).json("Operação inválida");

    const urlAuthentication = await axios.get(
      `${process.env.RS_ENDPOINT}/ozone/v1.0/auth-code-url/${consentId}?scope=payments&alg=none`,
      {
        httpsAgent,
        headers: {
          Authorization: `Basic ${process.env.BASIC_TOKEN}`,
        },
      }
    );

    return res.send(urlAuthentication.data);
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
});

module.exports = routes;