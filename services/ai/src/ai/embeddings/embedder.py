import torch
import numpy as np
from sentence_transformers import SentenceTransformer

class Embedder:
    def __init__(self, model_name: str):
        self.device = (
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        self.model = SentenceTransformer(
            model_name,
            device=self.device
        )

    def encode_documents(self, texts: list[str]):
        return self.model.encode(
            texts,
            batch_size=32,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

    def encode_query(self, query: str):
        return self.model.encode(
            query,
            normalize_embeddings=True,
            convert_to_numpy=True
        ).astype(np.float32)