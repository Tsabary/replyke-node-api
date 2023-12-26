import { Router, Request as ExReq, Response as ExRes } from "express";
import { Article } from "../models/article";
import IArticle from "../interfaces/IArticle";

const router = Router();

// Route to fetch a single article by its ID.
router.get("/replyke-articles/:article_id", async (req: ExReq, res: ExRes) => {
  try {
    // Extract article_id from the path parameters.
    const { article_id } = req.params;

    // Search for the article using Mongoose's findOne method.
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    // If no article is found, return a 404 (Not Found) status.
    if (!article) return res.status(404).send();

    // If an article is found, return it with a 200 (OK) status.
    return res.status(200).send(article);
  } catch (err: any) {
    // In case of any server errors, return a 500 (Internal Server Error) status.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route to like an article.
router.post("/replyke-articles/like", async (req: ExReq, res: ExRes) => {
  try {
    const { article_id, user_id } = req.body;

    // Validate the presence of article_id and user_id.
    if (!article_id || !user_id) {
      return res
        .status(400)
        .send("Missing article_id or user_id in request body");
    }

    // First we want to fetch the article
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    let newArticle;

    if (article) {
      // Prevent duplicate likes.
      if (article.likes.includes(user_id)) {
        return res.status(409).send("User already liked article");
      }

      // Update the article with the new like.
      newArticle = await Article.findOneAndUpdate(
        { article_id },
        {
          $inc: { likes_count: 1 },
          $push: { likes: user_id },
        },
        { new: true }
      );
    } else {
      // Create a new article if it doesn't exist.
      newArticle = new Article({
        article_id,
        likes: [user_id],
        likes_count: 1,
        comments_count: 0,
        replies_count: 0,
      });
      await newArticle.save();
    }

    // Return the updated or newly created article.
    return res.status(200).send(newArticle);
  } catch (err: any) {
    // Handle server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route to unlike an article.
router.post("/replyke-articles/unlike", async (req: ExReq, res: ExRes) => {
  try {
    const { article_id, user_id } = req.body;

    // Validate the presence of article_id and user_id.
    if (!article_id || !user_id) {
      return res
        .status(400)
        .send("Missing article_id or user_id in request body");
    }

    // Fetch the article to check if the user has already liked it.
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    // If the article does not exist or the user hasn't liked it.
    if (!article || !article.likes.includes(user_id)) {
      return res
        .status(409)
        .send("Can't unlike, as user didn't like article or article not found");
    }

    // Update the article, reducing the like count and removing the user's ID from likes.
    const updatedArticle = await Article.findOneAndUpdate(
      { article_id },
      {
        $inc: { likes_count: -1 },
        $pull: { likes: user_id },
      },
      { new: true }
    );

    // Return the updated article.
    return res.status(200).send(updatedArticle);
  } catch (err: any) {
    // Handle server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

export default router;
