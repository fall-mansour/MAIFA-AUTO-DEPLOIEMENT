import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from './environnement';

export interface CategorieStat {
  nom: string;
  nb: number;
  unites: number;
  valeur: number;
}

export interface MoisStat {
  mois: string; // "2026-09"
  nb: number;
  valeur: number;
}

export interface MarqueStat {
  marque: string;
  nb: number;
}

export interface ParcClient {
  marque: string;
  nb_clients: number;
  couverte: boolean;
}

export interface DernierePiece {
  id: number;
  ref?: string;
  description: string;
  categorie?: string;
  prix: number;
  quantite: number;
  etat?: string;
  img_principale?: string;
  date_ajout: string;
}

export interface StatsCommandes {
  total: number;
  en_attente: number;
  confirmees: number;
  livrees: number;
  annulees: number;
  montant_attente: number;
  chiffre_affaires: number;
  nouvelles_30j: number;
}

export interface DerniereCommande {
  id: number;
  reference: string;
  statut: 'en_attente' | 'confirmee' | 'livree' | 'annulee';
  total: number;
  nb_articles: number;
  date_commande: string;
  client: string;
  telephone: string;
}

export interface StatsPieces {
  // Compteurs historiques, conservés pour compatibilité
  total: number;
  motorisation: number;
  transmission: number;
  freinage: number;
  suspension: number;
  carrosserie: number;
  electronique: number;

  stock: {
    references: number;
    unites: number;
    valeur: number;
    prix_moyen: number;
    neuf: number;
    occasion: number;
  };

  alertes: {
    ruptures: number;
    stock_faible: number;
    sans_compatibilite: number;
    seuil: number;
  };

  clients: {
    total: number;
    nouveaux_30j: number;
    avec_vehicule: number;
  };

  referentiel: {
    marques: number;
    modeles: number;
    compatibilites: number;
    marques_couvertes: number;
  };

  commandes: StatsCommandes;

  categories: CategorieStat[];
  evolution: MoisStat[];
  top_marques: MarqueStat[];
  parc_clients: ParcClient[];
  dernieres: DernierePiece[];
  dernieres_commandes: DerniereCommande[];
}

@Injectable({ providedIn: 'root' })
export class PiecesService {
  private apiUrl = `${environment.apiUrl}/dashboard/stats`;

  constructor(private http: HttpClient) {}

  getStats(): Observable<StatsPieces> {
    return this.http.get<StatsPieces>(this.apiUrl);
  }
}
