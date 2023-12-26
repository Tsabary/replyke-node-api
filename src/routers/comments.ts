import { Router, Request as ExReq, Response as ExRes } from "express";
import { SortOrder } from "mongoose";
import { Comment } from "../models/comment";
import IComment from "../interfaces/IComment";
import { Article } from "../models/article";
import IArticle from "../interfaces/IArticle";

const router = Router();

// Route to retrieve comments with pagination and sorting options.
router.get("/replyke-comments", async (req: ExReq, res: ExRes) => {
  try {
    const { article_id, sort_by, parent, page = 1, limit = 5 } = req.query;

    // Convert 'limit' and 'page' to numbers and validate them.
    const limitAsNumber = Number(limit);
    if (isNaN(limitAsNumber)) {
      throw new Error("Invalid request: limit must be a number");
    }

    const pageAsNumber = Number(page);
    if (isNaN(pageAsNumber)) {
      throw new Error("Invalid request: page must be a number");
    }

    // Ensure 'page' is a whole number and greater than 0.
    if (pageAsNumber < 1 || pageAsNumber % 1 !== 0) {
      throw new Error(
        "Invalid request: 'page' must be a whole number greater than 0"
      );
    }

    // Define the sort filter based on 'sort_by' query parameter.
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

    // Calculate the number of results to skip for pagination.
    const skipCount = (pageAsNumber - 1) * limitAsNumber;

    // Fetch comments based on filters, pagination, and sorting.
    const comments = await Comment.find({
      article_id,
      parent,
    })
      .limit(limitAsNumber)
      .skip(skipCount)
      .sort(sort);

    // Respond with the fetched comments.
    return res.status(200).send(comments);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route for posting a new comment or reply to an article.
router.post("/replyke-comments", async (req: ExReq, res: ExRes) => {
  try {
    const { article_id, comment_body, parent, author } = req.body;

    // Validate the presence of required fields.
    if (!article_id || !comment_body || !author) {
      return res.status(400).send("Missing required comment details");
    }

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

    // Update the parent comment's reply count if this is a reply.
    if (parent) {
      await Comment.findByIdAndUpdate(parent, {
        $inc: { replies_count: 1 },
      });
    }

    // Fetch the article to update its comment or reply count.
    const article: IArticle | null = await Article.findOne({
      article_id,
    }).lean();

    if (article) {
      // Increment either the direct comments count or the replies count in the article.
      const updateField = parent
        ? { $inc: { replies_count: 1 } }
        : { $inc: { comments_count: 1 } };
      await Article.findOneAndUpdate({ article_id }, updateField);
    } else {
      // Create a new article record if it doesn't exist.
      const newArticle = new Article({
        article_id,
        likes: [],
        likes_count: 0,
        comments_count: 1,
        replies_count: 0,
      });
      await newArticle.save();
    }

    // Return the newly created comment or reply.
    return res.status(200).send(comment);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route for deleting a comment and its replies.
router.delete("/replyke-comments", async (req: ExReq, res: ExRes) => {
  try {
    const { comment_id } = req.body;

    // Ensure comment_id is provided.
    if (!comment_id) {
      return res.status(400).send("Comment ID is required");
    }

    // Retrieve the target comment to initiate the delete operation.
    const targetComment: IComment | null = await Comment.findById(
      comment_id
    ).lean();
    if (!targetComment) {
      return res.status(404).send("Comment not found");
    }

    // Initialize counters for the number of deleted comments and replies.
    let firstLevelCommentsDeletedCount = 0;
    let repliesDeletedCount = 0;

    // Recursive function to delete a comment and its child comments (replies).
    async function deleteCommentAndChildren(commentId: string) {
      // We first delete the comment. If all good, we should get the comment document back.
      const comment: IComment | null = await Comment.findByIdAndDelete(
        commentId
      ).lean();

      if (!comment) {
        throw new Error("Comment deletion failed");
      }

      // Increment appropriate counters based on whether the comment is a reply.
      comment.parent ? repliesDeletedCount++ : firstLevelCommentsDeletedCount++;

      // Delete all child comments (replies) of the current comment.
      const childComments: IComment[] = await Comment.find({
        parent: comment._id,
      }).lean();
      for (const childComment of childComments) {
        await deleteCommentAndChildren(childComment._id);
      }
    }

    // Start the deletion process for the target comment and its replies.
    await deleteCommentAndChildren(comment_id);

    // Update the parent comment's reply count if the target comment was a reply.
    if (targetComment.parent) {
      await Comment.findByIdAndUpdate(targetComment.parent, {
        $inc: { replies_count: -1 },
      });
    }

    // Update the corresponding article's comment and reply counts.
    const article = await Article.findOneAndUpdate(
      { article_id: targetComment.article_id },
      {
        $inc: {
          comments_count: -firstLevelCommentsDeletedCount,
          replies_count: -repliesDeletedCount,
        },
      },
      { new: true }
    );

    if (!article) {
      throw new Error("Article not found for updating comment counts");
    }

    // Return the updated article data.
    return res.status(200).send(article);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route for updating the content of a comment.
router.patch("/replyke-comments", async (req: ExReq, res: ExRes) => {
  try {
    const { update, comment_id } = req.body;

    // Validate the presence of update content and comment_id.
    if (!update || !comment_id) {
      return res.status(400).send("Update content and comment ID are required");
    }

    // Update the comment with the provided content.
    const updatedComment = await Comment.findOneAndUpdate(
      { _id: comment_id },
      { body: update },
      { new: true }
    );

    // If no comment was found or updated, return a 404 (Not Found) status.
    if (!updatedComment) {
      return res.status(404).send("Comment not found or update failed");
    }

    // Return the updated comment.
    return res.status(200).send(updatedComment);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route for liking a comment.
router.post("/replyke-comments/like", async (req: ExReq, res: ExRes) => {
  try {
    const { comment_id, user_id } = req.body;

    // Validate the presence of comment_id and user_id.
    if (!comment_id || !user_id) {
      return res.status(400).send("Comment ID and user ID are required");
    }

    // Retrieve the comment to be liked.
    const comment: IComment | null = await Comment.findById(comment_id).lean();
    if (!comment) {
      return res.status(404).send("Comment not found");
    }

    // Check if the user has already liked the comment.
    if (comment.likes.includes(user_id)) {
      return res.status(409).send("User has already liked this comment");
    }

    // Update the comment with the new like.
    const updatedComment = await Comment.findByIdAndUpdate(
      comment_id,
      { $inc: { likes_count: 1 }, $push: { likes: user_id } },
      { new: true }
    );

    // Return the updated comment.
    return res.status(200).send(updatedComment);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

// Route for unliking a comment.
router.post("/replyke-comments/unlike", async (req: ExReq, res: ExRes) => {
  try {
    const { comment_id, user_id } = req.body;

    // Validate the presence of comment_id and user_id.
    if (!comment_id || !user_id) {
      return res.status(400).send("Comment ID and user ID are required");
    }

    // Retrieve the comment to be unliked.
    const comment: IComment | null = await Comment.findById(comment_id).lean();
    if (!comment) {
      return res.status(404).send("Comment not found");
    }

    // Check if the user has liked the comment.
    if (!comment.likes.includes(user_id)) {
      return res.status(409).send("User hasn't liked this comment");
    }

    // Update the comment to remove the like.
    const updatedComment = await Comment.findByIdAndUpdate(
      comment_id,
      { $inc: { likes_count: -1 }, $pull: { likes: user_id } },
      { new: true }
    );

    // Return the updated comment.
    return res.status(200).send(updatedComment);
  } catch (err: any) {
    // Handle any server errors.
    return res.status(500).send({ error: "Server error" });
  }
});

export default router;
