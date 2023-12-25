export default interface IArticle {
  _id: string;
  article_id: string;
  likes: string[];
  likes_count: number;
  comments_count: number;
  replies_count: number;
}
