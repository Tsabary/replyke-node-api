import { Router, Request as ExReq, Response as ExRes } from "express";
import { Article } from "../models/article";
import IArticle from "../interfaces/IArticle";

const router = Router();

// Fetch a single article
router.get("/replyke-articles", async (req: ExReq, res: ExRes) => {
  try {
    const { article_id } = req.query;

    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    if (!article) return res.status(204).send();

    return res.status(200).send(article);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.post("/replyke-articles/like", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;

    if (!body) throw new Error("No request body was");

    const { article_id, user_id } = body;

    // First we want to fetch the article
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    // We create a variable, that will eventually be sent to the client
    let newArticle;

    // As an article document is only created once we have some data as likes or comments,
    // we need to check if we received anything form our article query or not, and handle both options slightly differently.
    if (article) {
      // If the likes array in the article document already contains the user's id,
      // we simply return without doing anything as the user can't like an article twice.
      if (article.likes.includes(user_id)) {
        return res.status(406).send("User already liked article");
      }

      // Otherwise, we update the article - we increase the like count by 1,
      // and add the user's id to the "likes" array
      await Article.findOneAndUpdate(
        { article_id },
        {
          $inc: { likes_count: 1 },
          $push: { likes: user_id },
        }
      );

      // We set the variable which we created before as the new article after the changes we've just made.
      newArticle = {
        ...article,
        likes_count: article.likes_count + 1,
        likes: [...article.likes, user_id],
      };
    }

    // Else, if we couldn't find an article document with the article ID we passed,
    // then it means that this like is the first piece of information we have a about this article
    else {
      // We simply create a new article document with one like,
      // and the user's id inside the likes array. We set the new article to the variable we created before
      newArticle = new Article({
        article_id,
        likes: [user_id],
        likes_count: 1,
        comments_count: 0,
        replies_count: 0,
      });
      await newArticle.save();
    }

    // If everything went well, we send the article back
    return res.status(200).send(newArticle);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.post("/replyke-articles/unlike", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;

    if (!body) throw new Error("No request body was found");

    const { article_id, user_id } = body;

    // We first need to find the article to make sure we've received a valid article id
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    // Not like the previous route, here we can't have a scenario in which an article document doesn't exist yet.
    // Un-liking an article implies the article has been liked before, which means it should already have a document in our database.
    // If we can't find the article, then we have some issue happening and we return a 404.
    // This shouldn't ever happen, but we do the check for extra safety.
    if (!article) {
      return res.status(404).send("Article not found");
    }

    // If the article's "likes" array doesn't include the user's id,
    // we simply return without doing anything as the user can't
    // unlike an article they don't currently like.
    if (!article.likes.includes(user_id)) {
      return res.status(406).send("Can't unlike, as user didn't like article");
    }

    // We update the article - we decrease the like count by 1,
    // and remove the user's id from the "likes" array.
    await Article.findOneAndUpdate(
      { article_id },
      {
        $inc: { likes_count: -1 },
        $pull: { likes: user_id },
      }
    );

    // We create a simple new article object with the updated data
    const newArticle = {
      ...article,
      likes_count: article.likes_count - 1,
      likes: article.likes.filter((l) => l !== user_id),
    };

    // If everything went well, we send the article back
    return res.status(200).send(newArticle);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

export default router;
