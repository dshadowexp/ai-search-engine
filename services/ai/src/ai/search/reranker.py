import torch
from sentence_transformers import CrossEncoder


class Reranker:
    def __init__(self, model_name: str):
        device = "cuda" if torch.cuda.is_available() else "cpu"

        self.model = CrossEncoder(
            model_name,
            device=device,
            max_length=512
        )

    def predict(self, pairs):
        return self.model.predict(
            pairs,
            batch_size=16,
            show_progress_bar=False,
            convert_to_numpy=True,
            activation_fn=torch.nn.Identity()
        )

    