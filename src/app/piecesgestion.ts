import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http'; // Import important
import { Observable } from 'rxjs';

export interface Piecegestion {
  _id?: string; // MongoDB utilise _id par défaut
  id?: number; // Gardé pour la compatibilité avec ton code actuel
  ref?: string;
  date_ajout?: string; // Date d'ajout de la pièce
  marque: string;
  modele: string;
  description: string;
  prix: number;
  quantite: number;
  annee: number;
  img: string; // Contiendra le chemin de l'image principale uploadée
  fournisseur?: string;
  etat?: string;
  categorie?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PiecesServicegestion {
  // L'URL de ton futur API Node.js
  private apiUrl = 'http://localhost:3000/api/stock';

  constructor(private http: HttpClient) {}

  // Récupérer toutes les pièces depuis la BD
  getPieces(): Observable<Piecegestion[]> {
    return this.http.get<Piecegestion[]>(this.apiUrl);
  }

  // Supprimer une pièce de la BD
  deletePiece(id: string | number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  // Optionnel : Récupérer une seule pièce
  getPieceById(id: string): Observable<Piecegestion> {
    return this.http.get<Piecegestion>(`${this.apiUrl}/${id}`);
  }
}
