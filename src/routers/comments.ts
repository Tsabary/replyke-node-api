import { Router, Request as ExReq, Response as ExRes } from "express";
import { SortOrder } from "mongoose";
import { Comment } from "../models/comment";
import IComment from "../interfaces/IComment";
import { Article } from "../models/article";
import IArticle from "../interfaces/IArticle";

const router = Router();

router.get("/comments", async (req: ExReq, res: ExRes) => {
  try {
    const {
      app_key,
      article_id,
      sort_by,
      parent,
      page = 1,
      limit = 5,
    } = req.query;

    // we want to paginate our results, so we need to have two pieces of data
    // 1. How many results we want to get (what is the limit),
    // 2. What page are we currently on.
    // As we get both of these pieces of information as strings,
    // we first convert them to a number
    // (and throw an error if any of them can't be converted to a number)
    const limitAsNumber = Number(limit);
    if (isNaN(limitAsNumber)) {
      throw new Error("Invalid request: limit must be a number");
    }

    const pageAsNumber = Number(page);
    if (isNaN(pageAsNumber)) {
      throw new Error("Invalid request: page must be a number");
    }

    // Also page can't be lower than 1, so we check for that as well
    if (pageAsNumber < 1) {
      throw new Error("Invalid request: page must be greater than 1");
    }

    // Also page can't have a decimal so we check for that as well
    if (pageAsNumber % 1 != 0) {
      throw new Error("Invalid request: page must be a whole number");
    }

    // Next we define our sort filter based on what we got in our query
    let sort: { [key: string]: SortOrder } = {};

    if (sort_by === "popular") {
      sort = { likes_count: -1, created_at: -1 };
    }
    if (sort_by === "newest") {
      sort = { created_at: -1 };
    }
    if (sort_by === "oldest") {
      sort = { created_at: 1 };
    }

    // Based on the page number and the limit, we figure out how many results we need to skip over
    const skipCount = (pageAsNumber - 1) * limitAsNumber;

    // We look up the comments we need with our filters
    const result = await Comment.find({
      article_id,
      parent,
    })
      .limit(limitAsNumber)
      .skip(skipCount)
      .sort(sort);

    // If all went well, we return the array with the comments
    return res.status(200).send(result);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.post("/comments", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;

    if (!body) throw new Error("No comment details were found");

    const { article_id, comment_body, parent, author } = body;

    const comment = new Comment({
      article_id,
      body: comment_body,
      parent,
      likes: [],
      likes_count: 0,
      replies_count: 0,
      created_at: new Date(),
      author,
    });
    await comment.save();

    // As comments and replies are treated as the same,
    // we need to check if this is a reply by checking if the comment has a parent or not.
    // If it does, we want to update the parent about the increase in its replies count
    if (parent) {
      await Comment.findByIdAndUpdate(parent, {
        $inc: { replies_count: 1 },
      });
    }

    // We try to fetch the article this comment belongs to
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    // Similarly to a situation we had in the articles routes,
    // we handle this situation also slightly differently whether we already have an article document or not.

    if (article) {
      // If we already have an article, we need to check if this comment has a parent or not.
      // Our article object keeps track of direct comments count and indirect comments count (replies to comments).
      // We need to check if this comment is a direct comment in order for us to know what property we need to update.

      // If it has a parent, it means this is an indirect comment to the article,
      // so we update the "replies_count" property in the article object
      if (parent) {
        await Article.findOneAndUpdate(
          { article_id },
          {
            $inc: { replies_count: 1 },
          }
        );
      }

      // If there is no parent, then this is a direct comment to the article,
      // so we update the "comments_count" property in the article object
      else {
        await Article.findOneAndUpdate(
          { article_id },
          {
            $inc: { comments_count: 1 },
          }
        );
      }
    }

    // If there is no article then surely this is a first level comment and there's no need to check if it has a parent
    else {
      // We simply create a new article with a comment count of one
      const newArticle = new Article({
        article_id,
        likes: [],
        likes_count: 0,
        comments_count: 1,
        replies_count: 0,
      });
      await newArticle.save();
    }

    // If all went well, we send the comment back
    return res.status(200).send(comment);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.delete("/comments", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;
    const { comment_id } = body;

    // We first find the comment. If all good, we should get the comment document back.
    // We will do all of our delete operations with a recursive function,
    // but we still need to get a hold of the initial target comment for other data manipulations
    const targetComment: IComment | null = await Comment.findById(
      comment_id
    ).lean();

    // If we got no comment document back then we throw an error
    if (!targetComment) throw new Error("Comment not found");

    // We will keep a count of the number of comments that have been deleted
    // so we could update the count in our article document
    let firstLevelCommentsDeletedCount = 0;
    let repliesDeletedCount = 0;

    // Let's create a recursive function that deletes comments and their children
    async function deleteCommentAndChildren(commentId: string) {
      // We first delete the comment. If all good, we should get the comment document back.
      const comment: IComment | null = await Comment.findByIdAndDelete(
        commentId
      ).lean();

      // If we got no comment document back then we throw an error.
      // Because this recursive function is based on the result of a previous operation,
      // the only time it could potentially fail in theory should be for the first comment ID we pass,
      // as all other IDs we will get back from our queries.
      if (!comment) throw new Error("Comment not found");

      // If this comment has a parent, we increase the count for the replies deleted,
      // and if it doesn't, then we increase the count for first level comments deleted.
      // The count for first level comments deleted could be at most one.
      if (comment.parent) {
        repliesDeletedCount += 1;
      } else {
        firstLevelCommentsDeletedCount += 1;
      }

      // We find all the replies for the comment we've just deleted,
      // and run them through this same function again as they need to get deleted as well.
      const childComments: IComment[] = await Comment.find({
        parent: comment._id,
      }).lean();

      // We now run each of the child comments through the same function
      for (const childComment of childComments) {
        await deleteCommentAndChildren(childComment._id);
      }
    }

    // We start our recursive function to delete this comment and all of its child comments.
    await deleteCommentAndChildren(comment_id);

    // If the target comment had a parent (meaning it was a reply)
    // then we should update the parent's reply count
    if (targetComment.parent) {
      await Comment.findByIdAndUpdate(targetComment.parent, {
        $inc: { replies_count: -1 },
      });
    }

    // We need to update the article's total number of comments and replies
    const article: IArticle | null = await Article.findOneAndUpdate(
      { article_id: targetComment.article_id },
      {
        $inc: {
          comments_count: -firstLevelCommentsDeletedCount,
          replies_count: -repliesDeletedCount,
        },
      }
    ).lean();

    // If for some reason we couldn't find the article
    // that needed to get updated we throw an error
    if (!article) throw new Error("No article found");

    // We create an updated article object to pass back to the comment section
    const updatedArticle = {
      ...article,
      comments_count: article.comments_count - firstLevelCommentsDeletedCount,
      replies_count: article.replies_count - repliesDeletedCount,
    };

    return res.status(200).send(updatedArticle);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.patch("/comments", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;
    const { update, comment_id } = body;

    await Comment.findOneAndUpdate({ _id: comment_id }, { body: update });

    return res.status(200).send();
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.post("/comments/like", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;

    if (!body) throw new Error("No request body was found");

    const { comment_id, user_id } = body;

    // We first need to find the comment
    const comment: IComment | null = await Comment.findById(comment_id).lean();

    // If we couldn't find the comment we return a 404
    if (!comment) {
      return res.status(404).send("Comment not found");
    }

    // If the likes array in the comment document already contains the user's id,
    // we simply return without doing anything as the user can't like a comment twice.
    if (comment.likes.includes(user_id)) {
      return res.status(406).send("Can't like - user already liked comment");
    }

    // Otherwise, we update the comment -
    // we increase the like count by 1, and add the user's id to the "likes" array
    await Comment.findByIdAndUpdate(comment_id, {
      $inc: { likes_count: 1 },
      $push: { likes: user_id },
    });

    // We create a simple comment object with the updated comment data
    const newComment = {
      ...comment,
      likes_count: comment.likes_count + 1,
      likes: [...comment.likes, user_id],
    };

    // If everything went well, we send the comment back
    return res.status(200).send(newComment);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

router.post("/comments/unlike", async (req: ExReq, res: ExRes) => {
  try {
    const body = req.body;

    if (!body) throw new Error("No request body was found");

    const { comment_id, user_id } = body;

    // We first need to find the comment
    const comment: IComment | null = await Comment.findById(comment_id).lean();

    // If we couldn't find the comment we return a 404
    if (!comment) {
      return res.status(404).send("Comment not found");
    }

    // If the comment's "likes" array doesn't include the user's id,
    // we simply return without doing anything as the user can't unlike an comment they don't currently like.
    if (!comment.likes.includes(user_id)) {
      return res.status(406).send("Can't unlike, as user didn't like comment");
    }

    // We update the comment - we decrease the like count by 1,
    // and remove the user's id from the "likes" array
    await Comment.findByIdAndUpdate(comment_id, {
      $inc: { likes_count: -1 },
      $pull: { likes: user_id },
    });

    // We create a simple new comment object with the updated data
    const newComment = {
      ...comment,
      likes_count: comment.likes_count - 1,
      likes: comment.likes.filter((l) => l !== user_id),
    };

    // If everything went well, we send the comment back
    return res.status(200).send(newComment);
  } catch (err: any) {
    return res.status(500).send({ error: err.message });
  }
});

export default router;
