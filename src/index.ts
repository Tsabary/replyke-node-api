const dotenv = require("dotenv");
dotenv.config();

import cors from "cors";
import express from "express";
import http from "http";
import articlesRouter from "./routers/articles";
import commentsRouter from "./routers/comments";

require("./db/mongoose");

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

app.use(express.json());

app.use(articlesRouter);
app.use(commentsRouter);

const PORT = process.env.PORT;

server.listen(PORT, () => {
  console.log(
    `****************************************************************************************************************************************************************** SERVER IS RUNNING ON PORT ${PORT}*****************************************************************************************************************************************************************************`
  );
});
